// sensor_node — N-sensor tiltmeter (TCA9548A multiplexed).
//
// This file is the orchestrator: setup() + loop(). The work lives in the modules:
//   Config.h   - tuning constants, pins, the SENSORS[] table (edit here)
//   SensorNode - per-sensor runtime state (in Config.h)
//   Button    - debounce + edge detection (short press = baseline)
//   Led      - the 4-state LED machine (off / fast / solid / heartbeat)
//   Baseline  - 30 s collection + NVS persistence (survives reboot)
//   Report    - the per-second table (header + per-sensor cells + tilt math)
//
// ── Adding a sensor: add a line to SENSORS[] in Config.h. That's it — the
// sample/report/zero loops iterate the array automatically.
//
// Baselines persist across reboots (ESP32 NVS). Still no WiFi/Supabase/sleep/
// alarm logic yet, and no gateway persistence (that's a later step).

#include <stdio.h>   // snprintf
#include <Wire.h>
#include "Config.h"
#include "Button.h"
#include "Led.h"
#include "Baseline.h"
#include "Identity.h"
#include "Alarm.h"
#include "Rs485.h"
#include "Sender.h"   // cloud sync runs in its own FreeRTOS task (Phase B)
#include "Report.h"

// ---------------------------------------------------------------------------
// Runtime state owned by the orchestrator.
// ---------------------------------------------------------------------------

SensorNode nodes[NUM_SENSORS];   // defined here; extern-declared in Config.h

// Loop timing + table row counter
unsigned long lastSample = 0;
unsigned long lastReport = 0;
uint16_t      rowCount   = 0;
bool          wasGateway = false;   // transition tracker: connect WiFi if promoted at runtime

// ---------------------------------------------------------------------------
// setup() — init bus, scan for sensors, wake the ones that answered,
// restore any saved baselines, ready the field interface.
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  initIdentity();                 // node MAC: the backend's join key (Step 6)
  Wire.begin(21, 22);              // SDA 21, SCL 22 — called ONCE here
  delay(500);

  Serial.print("Scanning ");
  Serial.print(NUM_SENSORS);
  Serial.println(" sensors...");
  for (uint8_t i = 0; i < NUM_SENSORS; i++) {
    nodes[i].mpu.begin(SENSORS[i].channel);   // store channel + select + wake
    nodes[i].present = nodes[i].mpu.probe(); // ACK check at the MPU address
    Serial.print(SENSORS[i].name);
    Serial.print(" (ch");
    Serial.print(SENSORS[i].channel);
    Serial.print("): ");
    Serial.println(nodes[i].present ? "present" : "MISSING");
  }

  loadBaselinesFromFlash();   // restore the reference if one was saved
  loadGatewayFromFlash();     // restore the master role if one was set (Step 5)
  loadThresholdFromFlash();   // restore the alert threshold if one was set (Step 8)

  Serial.println("MPU6050 ready. 'z' = baseline (or short-press), 'g' = toggle gateway (or long-press ≥ 3 s), 'r' = reboot.");

  pinMode(BUTTON_PIN, INPUT_PULLUP);  // button: HIGH when open, LOW when pressed
  pinMode(LED_PIN, OUTPUT);           // LED (the Led module drives its states)
  digitalWrite(LED_PIN, LOW);         // start off

  // Threshold alarm (Step 7): buzzer pin + a 100 ms power-on self-test beep
  // so the installer knows the alarm is wired and working.
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, HIGH);
  delay(100);
  digitalWrite(BUZZER_PIN, LOW);

  rs485Init();   // RS-485 link (feat/transport Phase A) — DE=25, TX=33, RX=18

  // Phase B: the gateway is the only box with WiFi + cloud sync. Starting the
  // sender task spins up WiFi + HTTP on its own core — it must not run here
  // (blocking) or on the main loop.
  if (isThisGateway()) senderInit();
  wasGateway = isThisGateway();   // seed the transition tracker so a boot-as-gateway doesn't double-init
}

// ---------------------------------------------------------------------------
// loop() — three blocks, each iterating the sensor array. No delay() anywhere:
// every block checks millis() and only acts when due, so the CPU stays free.
// ---------------------------------------------------------------------------
void loop() {
  unsigned long now = millis();

  pollButton();      // field interface: button edge detection
  updateLed();       // drive the LED for the current state
  updateAlarm();     // drive the buzzer for the current alarm state (Step 7)
  rs485Update();     // RS-485: receive lines + master poll schedule (Phase A)

  // Cloud baseline recovery (spec §7.2, NVS-empty path): a SLAVE with no
  // baselines periodically asks the master (F;) for them; when the master's
  // Q; reply arrives, anyPresentBaseline() turns true and we stop.
  if (!isThisGateway() && !anyPresentBaseline()) {
    static unsigned long lastReq = 0;
    static uint8_t       attempts = 0;
    if (millis() - lastReq >= BASELINE_RECOVERY_INTERVAL_MS && attempts < BASELINE_RECOVERY_ATTEMPTS) {
      lastReq = millis(); attempts++;
      rs485SendBaselineRequest();
      Serial.print("[rs485] requesting baselines from master (attempt ");
      Serial.print(attempts); Serial.print("/");
      Serial.print(BASELINE_RECOVERY_ATTEMPTS); Serial.println(")");
    }
  }

  // Relay a slave's fetched baselines (staged by the cloud task) back over
  // the bus as a Q; frame — all RS-485 TX stays in the main-loop context.
  {
    char macOut[18];
    SenderBaseline sb[NUM_SENSORS];
    int n = 0;
    if (senderTakeBaselineReply(macOut, sb, n)) rs485SendBaselineReply(macOut, sb, n);
  }

  // Realtime threshold sync: if the cloud task just learned a new threshold
  // from the app/Supabase, broadcast it to every slave (all RS-485 TX stays
  // in the main-loop context). Slaves apply it to their own local alarm + NVS.
  float newTh;
  if (senderTakeThresholdChange(newTh)) rs485BroadcastThreshold(newTh);

  // A box promoted to gateway AT RUNTIME (long-press) never went through
  // setup()'s task start — start it on the rising edge. The task itself
  // connects WiFi and fetches the threshold.
  if (isThisGateway() && !wasGateway) {
    Serial.println("[cloud] became gateway at runtime — starting cloud task");
    senderInit();
  }
  wasGateway = isThisGateway();

  // ── Sample block: every 10 ms, read each present sensor and accumulate ──
  if (now - lastSample >= SAMPLE_INTERVAL_MS) {
    lastSample = now;
    for (uint8_t i = 0; i < NUM_SENSORS; i++) {
      if (!nodes[i].present) continue;
      int16_t ax, ay, az;
      if (nodes[i].mpu.readAccel(ax, ay, az)) {
        nodes[i].sumX += ax;  nodes[i].sumY += ay;  nodes[i].sumZ += az;
        nodes[i].sampleCount++;
        if (baselineCollecting) {   // also feed the baseline accumulators
          nodes[i].bsumX += ax;  nodes[i].bsumY += ay;  nodes[i].bsumZ += az;
          nodes[i].bcount++;
        }
      } else {
        nodes[i].failCount++;            // bus drop; n will be < 100 in the report
      }
    }
  }

  // ── Serial commands: 'z' = start baseline collection, 'g' = toggle gateway.
  // Reads EVERY available byte so it works regardless of the serial monitor's
  // line-ending setting — the old single-byte pattern could swallow a command.
  // Same actions as the button: short press (baseline) / long press (gateway).
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == 'z') {
      doBaselineSet();   // global capture: this box + (on gateway) broadcast `C` to slaves
    } else if (c == 'g') {
      toggleGateway();   // prints ON/OFF itself
    } else if (c == 'r') {
      // Hard reboot (esp_restart): handy to re-trigger NVS-empty baseline
      // recovery after the 5-attempt window elapses — no physical reset needed.
      Serial.println("Rebooting now (recovery re-attempts)...");
      ESP.restart();
    }
  }

  // ── Report block: every 1 s → one TABLE ROW, sensors as columns ──
  if (now - lastReport >= REPORT_INTERVAL_MS) {
    lastReport = now;

    char blocks[NUM_SENSORS][40];
    for (uint8_t i = 0; i < NUM_SENSORS; i++) formatSensorBlock(blocks[i], i);

    // Reprint the header periodically so it stays visible while scrolling.
    if (rowCount == 0 || rowCount >= HEADER_EVERY) {
      printReportHeader();
      rowCount = 0;
    }
    rowCount++;

    // Print one row: time column + one block per sensor, separated by '|'.
    char timebuf[16];
    snprintf(timebuf, sizeof timebuf, "%*.*f", TIME_W, 1, (double)(now / 1000.0));
    Serial.print(timebuf);
    for (uint8_t i = 0; i < NUM_SENSORS; i++) {
      Serial.print('|');
      Serial.print(blocks[i]);
    }
    Serial.println();

    evaluateAlarms();   // check each sensor's tilt vs the threshold (Step 7)

    // Phase B: the gateway enqueues its OWN readings into the send batch
    // (the slave's readings arrive separately via RS-485 and are enqueued there).
    if (isThisGateway()) {
      for (uint8_t i = 0; i < NUM_SENSORS; i++) {
        if (!nodes[i].present) continue;
        senderAddReading(nodeMac, SENSORS[i].channel,
                         nodes[i].lastTilt, nodes[i].lastMag, nodes[i].lastTemp,
                         nodes[i].lastN, nodes[i].lastFail,
                         nodes[i].lastTilt > getThresholdDeg());
      }
    }

    // Route an alarm trip (one-shot). Gateway -> Supabase directly; slave ->
    // relay an A: frame to the master, which forwards it to the cloud.
    // (Either way, the tripping node's local buzzer already fired.)
    uint8_t ach; float av;
    if (alertTripPending(ach, av)) {
      if (isThisGateway()) senderPushAlert(nodeMac, ach, "threshold", "critical", av);
      else                 rs485SendAlert(ach, av);
    }
  }

  // ── Baseline collection completion: after BASELINE_COLLECT_SECONDS, average
  //   the accumulated samples and set each sensor's baseline.
  // Use a FRESH millis() here — `now` was captured at the top of loop, and
  // a collection started mid-loop (serial 'z') sets baselineCollectStart LATER
  // than `now`, so `now - baselineCollectStart` would wrap unsigned and look
  // like 30 s had already elapsed, firing the completion instantly.
  unsigned long t = millis();
  if (baselineCollecting && t >= baselineCollectStart &&
      (t - baselineCollectStart) >= BASELINE_COLLECT_SECONDS * 1000UL) {
    finalizeBaselineCapture();
    // Newly captured baselines must reach the cloud: the gateway POSTs its
    // own sensors directly; a slave relays B; frames so the master uploads
    // them. (NVS persistence already happened inside finalizeBaselineCapture.)
    if (isThisGateway()) {
      for (uint8_t i = 0; i < NUM_SENSORS; i++) {
        if (!nodes[i].present || !nodes[i].hasBaseline) continue;
        senderUploadBaseline(nodeMac, SENSORS[i].channel,
                             nodes[i].bx, nodes[i].by, nodes[i].bz);
      }
    } else {
      for (uint8_t i = 0; i < NUM_SENSORS; i++) {
        if (!nodes[i].present || !nodes[i].hasBaseline) continue;
        rs485SendBaseline(SENSORS[i].channel,
                          nodes[i].bx, nodes[i].by, nodes[i].bz);
      }
    }
  }

  recomputeLedState();   // keep the LED in sync (baselines may have just applied)
}
