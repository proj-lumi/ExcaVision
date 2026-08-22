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
#include "Report.h"

// ---------------------------------------------------------------------------
// Runtime state owned by the orchestrator.
// ---------------------------------------------------------------------------

SensorNode nodes[NUM_SENSORS];   // defined here; extern-declared in Config.h

// Loop timing + table row counter
unsigned long lastSample = 0;
unsigned long lastReport = 0;
uint16_t      rowCount   = 0;

// ---------------------------------------------------------------------------
// setup() — init bus, scan for sensors, wake the ones that answered,
// restore any saved baselines, ready the field interface.
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
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

  Serial.println("MPU6050 ready. 'z' = baseline (or short-press), 'g' = toggle gateway (or long-press ≥ 3 s).");

  pinMode(BUTTON_PIN, INPUT_PULLUP);  // button: HIGH when open, LOW when pressed
  pinMode(LED_PIN, OUTPUT);           // LED (the Led module drives its states)
  digitalWrite(LED_PIN, LOW);         // start off
}

// ---------------------------------------------------------------------------
// loop() — three blocks, each iterating the sensor array. No delay() anywhere:
// every block checks millis() and only acts when due, so the CPU stays free.
// ---------------------------------------------------------------------------
void loop() {
  unsigned long now = millis();

  pollButton();      // field interface: button edge detection
  updateLed();       // drive the LED for the current state

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
      startBaselineCapture();
    } else if (c == 'g') {
      toggleGateway();   // prints ON/OFF itself
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
  }

  recomputeLedState();   // keep the LED in sync (baselines may have just applied)
}
