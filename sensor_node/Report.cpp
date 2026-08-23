#include <stdio.h>    // snprintf
#include <math.h>     // sqrt, atan2, PI
#include "Config.h"      // tuning constants, SENSORS[], SensorNode, nodes[]
#include "Identity.h"    // nodeMac — tag the report with the node identity
#include "Report.h"

// Center a string in a fixed width (for the header's sensor-name row).
static void printCentered(const char* s, uint8_t w) {
  uint8_t len = strlen(s);
  if (len >= w) { Serial.print(s); return; }
  uint16_t pad = w - len;
  for (uint16_t i = 0; i < pad / 2; i++) Serial.print(' ');
  Serial.print(s);
  for (uint16_t i = 0; i < pad - pad / 2; i++) Serial.print(' ');
}

// Print the 3-line table header (names, labels, separator). Scales with N.
// Prefixed with the node MAC so every chunk of data is visibly tagged with
// who produced it (the backend joins on this identity).
void printReportHeader() {
  Serial.print("mac "); Serial.println(nodeMac);
  // names row
  printCentered("time", TIME_W);
  for (uint8_t i = 0; i < NUM_SENSORS; i++) {
    Serial.print('|');
    printCentered(SENSORS[i].name, BLOCK_W);
  }
  Serial.println();
  // labels row — field widths match the data block exactly so columns align
  Serial.print("  (s)  ");                // TIME_W wide, aligned with the time dashes above
  for (uint8_t i = 0; i < NUM_SENSORS; i++) {
    Serial.print('|');
    char lab[40];
    snprintf(lab, sizeof lab, " %6s %5s %5s %8s", "tilt", "|g|", "T", "n/fail");
    Serial.print(lab);
  }
  Serial.println();
  // separator row
  for (uint8_t i = 0; i < TIME_W; i++) Serial.print('-');
  for (uint8_t i = 0; i < NUM_SENSORS; i++) {
    Serial.print('+');
    for (uint8_t j = 0; j < BLOCK_W; j++) Serial.print('-');
  }
  Serial.println();
}

// Format one sensor's cell for the report table and reset its 1 s window.
// If no baseline / no samples this window, shows -- placeholders.
void formatSensorBlock(char* buf, uint8_t i) {
  if (!nodes[i].present || nodes[i].sampleCount == 0) {
    snprintf(buf, 40, " %6s %5s %5s %4d/%-3d", "--", "--", "--", 0, nodes[i].failCount);
    nodes[i].lastTilt = 0;   // no data this window -> no valid tilt to alarm on
    nodes[i].lastMag = nodes[i].lastTemp = 0;
    nodes[i].lastN = 0;
    nodes[i].lastFail = nodes[i].failCount;   // keep the fail count visible
  } else {
    // mean raw counts -> g
    float gx = (float)nodes[i].sumX / nodes[i].sampleCount / COUNTS_PER_G;
    float gy = (float)nodes[i].sumY / nodes[i].sampleCount / COUNTS_PER_G;
    float gz = (float)nodes[i].sumZ / nodes[i].sampleCount / COUNTS_PER_G;
    float mag = sqrt(gx*gx + gy*gy + gz*gz);   // |g|, should be approx 1.000
    float tempC = nodes[i].mpu.readTemperatureC();

    // Remember this cycle's values for anything that needs the latest reading
    // (the Alarm module, and the RS-485 slave when it answers a poll).
    nodes[i].lastMag  = mag;
    nodes[i].lastTemp = tempC;
    nodes[i].lastN    = nodes[i].sampleCount;
    nodes[i].lastFail = nodes[i].failCount;

    // Tilt = angle between current and baseline gravity directions.
    // atan2(|cross|, dot) is numerically safe for the small angles we care
    // about (unlike acos, which is sick near 0).
    float tiltDeg = 0.0;
    if (nodes[i].hasBaseline) {
      float ux = gx/mag, uy = gy/mag, uz = gz/mag;
      float dot = ux*nodes[i].bx + uy*nodes[i].by + uz*nodes[i].bz;
      float cx  = uy*nodes[i].bz - uz*nodes[i].by;   // current x baseline
      float cy  = uz*nodes[i].bx - ux*nodes[i].bz;
      float cz  = ux*nodes[i].by - uy*nodes[i].bx;
      float crossMag = sqrt(cx*cx + cy*cy + cz*cz);
      tiltDeg = atan2(crossMag, dot) * 180.0 / PI;
      nodes[i].lastTilt = tiltDeg;   // share with the Alarm module
      snprintf(buf, 40, " %6.3f %5.3f %5.1f %4d/%-3d",
               tiltDeg, mag, tempC, nodes[i].sampleCount, nodes[i].failCount);
    } else {
      nodes[i].lastTilt = 0;   // no baseline -> tilt unknown, don't alarm
      snprintf(buf, 40, " %6s %5.3f %5.1f %4d/%-3d",
               "--", mag, tempC, nodes[i].sampleCount, nodes[i].failCount);
    }
  }

  // reset THIS sensor's 1 s window for the next report
  nodes[i].sumX = nodes[i].sumY = nodes[i].sumZ = 0;
  nodes[i].sampleCount = 0;
  nodes[i].failCount   = 0;
}
