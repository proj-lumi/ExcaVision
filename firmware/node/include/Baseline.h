#ifndef BASELINE_H
#define BASELINE_H

// Baseline lifecycle: 30 s collection -> average -> commit -> persist to NVS.
// A reboot restores the reference (loadBaselinesFromFlash); it never
// auto-re-zeroes.

void startBaselineCapture();     // short press / 'z': begin a 30 s collection window
void doBaselineSet();            // global capture: own window + (on gateway) broadcast `C` to slaves
void finalizeBaselineCapture();   // called when the window elapses: average + commit
void saveBaselinesToFlash();       // persist to NVS (so a reboot keeps the reference)
void loadBaselinesFromFlash();     // restore at boot (only for physically-present sensors)
bool anyPresentBaseline();          // true if any present sensor has a baseline loaded (drives NVS-empty recovery)

// Collection state (owned here; the loop's completion check reads these).
extern bool          baselineCollecting;
extern unsigned long baselineCollectStart;

#endif
