// WBS 4.0 — Process Readings

#include <stdio.h>   // snprintf
#include <esp_system.h>
#include <Wire.h>
#include "Config.h"
#include "Button.h"
#include "Led.h"
#include "Baseline.h"
#include "Identity.h"
#include "Alarm.h"
#include "Rs485.h"
#include "Sender.h"   // Cloud I/O runs in a separate task.
#include "TestingReset.h"
#include "Report.h"

// Shared node state.

SensorNode nodes[NUM_SENSORS];   // defined here; extern-declared in Config.h

// Loop timing + table row counter
unsigned long lastSample = 0;
unsigned long lastReport = 0;
uint16_t      rowCount   = 0;
bool          wasGateway = false;

static void reportSlowPhase(const char* phase, unsigned long startedAt) {
  const unsigned long elapsed = millis() - startedAt;
  if (elapsed < 50UL) return;

  static unsigned long lastWarningAt = 0;
  const unsigned long now = millis();
  if (now - lastWarningAt < 1000UL) return;
  lastWarningAt = now;
  Serial.print("[timing] slow ");
  Serial.print(phase);
  Serial.print(": ");
  Serial.print(elapsed);
  Serial.println(" ms");
}

// Initialize sensors and restore saved state.
void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.print("[boot] ESP32 reset reason: ");
  Serial.println((int)esp_reset_reason());
  initIdentity();
  Wire.begin(21, 22);              // SDA 21, SCL 22 — called ONCE here
  Wire.setTimeOut(5);               // never let a faulty sensor stall button/LED handling
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
  loadGatewayFromFlash();     // Node 1 may persistently enable/disable cloud mode
  loadThresholdFromFlash();

  Serial.print("role: ");
  if (isThisGateway()) {
    Serial.println("gateway");
  } else {
    Serial.print("sensor node / gateway disabled");
    // Explains why Gateway toggle is ignored on this board.
    Serial.println(wasServedAsSlave() ? " (serving a master; full reset before reassignment)" : "");
  }
  Serial.println("MPU6050 ready. 'z' = baseline start/cancel, 'g' = gateway toggle, 'r' = full state reset.");

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);           // LED (the Led module drives its states)
  digitalWrite(LED_PIN, LOW);         // start off

  // Test the buzzer at startup.
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, HIGH);
  delay(100);
  digitalWrite(BUZZER_PIN, LOW);

  rs485Init();

  // Keep blocking Gateway network I/O off the main loop.
  if (isThisGateway()) senderInit();
  wasGateway = isThisGateway();

  recomputeLedState();
  startFieldInterfaceTask();
}

static void executeQueuedButtonActions() {
  ButtonAction action;
  while (takeButtonAction(action)) {
    switch (action) {
      case BUTTON_ACTION_BASELINE_TOGGLE:
        Serial.println("[button] action: baseline start/cancel");
        toggleBaselineSet();
        break;
      case BUTTON_ACTION_GATEWAY_TOGGLE:
        Serial.println("[button] action: Gateway toggle");
        toggleGatewayFromButton();
        break;
      case BUTTON_ACTION_FULL_RESET:
        Serial.println("[button] action: full state reset");
        completeUnitReset();
        break;
      case BUTTON_ACTION_NONE:
        break;
    }
    recomputeLedState();
  }
}

// Button and LED timing run independently of sensor and transport work.
void loop() {
  unsigned long now = millis();

  // Runtime diagnostic: report only severe scheduling gaps. A healthy node
  // should service the button and LED much more often than their 30/100 ms
  // timing requirements. This exposes I2C/RS-485 starvation without flooding
  // the serial monitor during normal operation.
  static unsigned long previousLoopAt = now;
  static unsigned long worstLoopGap = 0;
  static unsigned long lastTimingReportAt = now;
  const unsigned long loopGap = now - previousLoopAt;
  previousLoopAt = now;
  if (loopGap > worstLoopGap) worstLoopGap = loopGap;
  if (now - lastTimingReportAt >= 5000UL) {
    if (worstLoopGap >= 50UL) {
      Serial.print("[timing] worst main-loop gap: ");
      Serial.print(worstLoopGap);
      Serial.println(" ms");
    }
    worstLoopGap = 0;
    lastTimingReportAt = now;
  }

  executeQueuedButtonActions();
  updateAlarm();
  unsigned long phaseStartedAt = millis();
  rs485Update();
  reportSlowPhase("RS-485 update", phaseStartedAt);
  senderWatchdog();  // recover the cloud task if a TLS/socket call never returned

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

  if (isThisGateway() && !wasGateway) senderInit();
  wasGateway = isThisGateway();

  // ── Sample block: every 10 ms, read each present sensor and accumulate ──
  if (now - lastSample >= SAMPLE_INTERVAL_MS) {
    lastSample = now;
    for (uint8_t i = 0; i < NUM_SENSORS; i++) {
      if (!nodes[i].present) continue;
      int16_t ax, ay, az;
      phaseStartedAt = millis();
      const bool accelRead = nodes[i].mpu.readAccel(ax, ay, az);
      reportSlowPhase(SENSORS[i].name, phaseStartedAt);
      if (accelRead) {
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

  // ── Serial commands mirror the three physical-button actions exactly.
  // Read every available byte so this works with any monitor line ending.
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == 'z') {
      toggleBaselineSet();
    } else if (c == 'g') {
      toggleGatewayFromButton();
    } else if (c == 'r') {
      completeUnitReset();
    }
  }

  // ── Report block: every 1 s → one TABLE ROW, sensors as columns ──
  if (now - lastReport >= REPORT_INTERVAL_MS) {
    lastReport = now;
    const unsigned long reportStartedAt = millis();

    char blocks[NUM_SENSORS][40];
    for (uint8_t i = 0; i < NUM_SENSORS; i++) {
      phaseStartedAt = millis();
      formatSensorBlock(blocks[i], i);
      reportSlowPhase(SENSORS[i].name, phaseStartedAt);
    }

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

    evaluateAlarms();

    // Local readings join the batch; other nodes arrive over RS-485.
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
      if (isThisGateway()) senderPushAlert(nodeMac, ach, av);
      else                 rs485SendAlert(ach, av);
    }
    reportSlowPhase("report block", reportStartedAt);
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

  executeQueuedButtonActions();
  recomputeLedState();   // field task applies this state without loop-timing jitter
}
