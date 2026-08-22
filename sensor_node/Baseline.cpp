#include <Arduino.h>
#include <Preferences.h>   // ESP32 NVS flash storage
#include <math.h>         // sqrt
#include "Config.h"      // tuning constants, SENSORS[], SensorNode, nodes[]

// NVS access (internal to this module).
static Preferences prefs;

// Collection state (owned here; extern-declared in Baseline.h).
bool          baselineCollecting = false;
unsigned long baselineCollectStart = 0;

// Starts a baseline collection period on all present sensors. Called by
// serial 'z' AND by a short button press — one action, two input methods.
// Samples accumulate for BASELINE_COLLECT_SECONDS, then are averaged into
// each sensor's baseline. The LED fast-blinks during collection.
void startBaselineCapture() {
  for (uint8_t i = 0; i < NUM_SENSORS; i++) {
    if (nodes[i].present) {
      nodes[i].bsumX = nodes[i].bsumY = nodes[i].bsumZ = 0;
      nodes[i].bcount = 0;
    }
  }
  baselineCollecting = true;
  baselineCollectStart = millis();
  Serial.print("collecting baseline for ");
  Serial.print(BASELINE_COLLECT_SECONDS);
  Serial.println(" s (LED fast-blinks during collection)...");
}

// Persist each present sensor's baseline to ESP32 flash (NVS) so a reboot
// restores the reference instead of losing it. Keys are channel-based so
// they survive SENSORS[] reordering.
void saveBaselinesToFlash() {
  prefs.begin("baselines", false);   // RW namespace
  for (uint8_t i = 0; i < NUM_SENSORS; i++) {
    if (nodes[i].present && nodes[i].hasBaseline) {
      char key[12];
      snprintf(key, sizeof key, "bx%u", SENSORS[i].channel);
      prefs.putFloat(key, nodes[i].bx);
      snprintf(key, sizeof key, "by%u", SENSORS[i].channel);
      prefs.putFloat(key, nodes[i].by);
      snprintf(key, sizeof key, "bz%u", SENSORS[i].channel);
      prefs.putFloat(key, nodes[i].bz);
    }
  }
  prefs.end();   // commit to flash
}

// Restore baselines from flash at boot. Only applied to sensors that are
// physically present (a missing sensor can't be monitored regardless).
// This LOADS an existing reference — it never auto-re-zeroes. If the box was
// moved while off, tilt will correctly show the movement against the old
// reference; a reboot is not permission to silently reset it.
void loadBaselinesFromFlash() {
  prefs.begin("baselines", true);    // read-only
  uint8_t loaded = 0;
  for (uint8_t i = 0; i < NUM_SENSORS; i++) {
    char key[12];
    snprintf(key, sizeof key, "bx%u", SENSORS[i].channel);
    if (!nodes[i].present || !prefs.isKey(key)) continue;
    nodes[i].bx = prefs.getFloat(key, 0.0f);
    snprintf(key, sizeof key, "by%u", SENSORS[i].channel);
    nodes[i].by = prefs.getFloat(key, 0.0f);
    snprintf(key, sizeof key, "bz%u", SENSORS[i].channel);
    nodes[i].bz = prefs.getFloat(key, 0.0f);
    nodes[i].hasBaseline = true;
    loaded++;
    Serial.print("baseline "); Serial.print(SENSORS[i].name);
    Serial.println(" loaded from flash");
  }
  prefs.end();
  if (loaded > 0) {
    Serial.print(loaded); Serial.println(" baseline(s) restored from flash — monitoring resumes");
  }
}

// Called when the collection period elapses: average each sensor's
// accumulated samples into its baseline unit vector.
void finalizeBaselineCapture() {
  uint8_t collected = 0;
  for (uint8_t i = 0; i < NUM_SENSORS; i++) {
    if (!nodes[i].present || nodes[i].bcount == 0) continue;
    float gx = (float)nodes[i].bsumX / nodes[i].bcount / COUNTS_PER_G;
    float gy = (float)nodes[i].bsumY / nodes[i].bcount / COUNTS_PER_G;
    float gz = (float)nodes[i].bsumZ / nodes[i].bcount / COUNTS_PER_G;
    float mag = sqrt(gx*gx + gy*gy + gz*gz);
    nodes[i].bx = gx/mag;  nodes[i].by = gy/mag;  nodes[i].bz = gz/mag;
    nodes[i].hasBaseline = true;
    collected++;
    Serial.print("baseline "); Serial.print(SENSORS[i].name);
    Serial.print(" set: (");
    Serial.print(nodes[i].bx, 4); Serial.print(", ");
    Serial.print(nodes[i].by, 4); Serial.print(", ");
    Serial.print(nodes[i].bz, 4);
    Serial.print(") — averaged over "); Serial.print(nodes[i].bcount);
    Serial.println(" samples");
  }
  saveBaselinesToFlash();   // persist so a reboot keeps this reference
  baselineCollecting = false;
  if (collected == 0) {
    Serial.println("WARNING: no samples collected during the baseline window — check sensors/bus");
  }
}
