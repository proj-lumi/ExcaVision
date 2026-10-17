#ifndef BASELINE_H
#define BASELINE_H

// Baseline lifecycle: 30 s collection -> average -> commit -> persist to NVS.
// A reboot restores the reference (loadBaselinesFromFlash); it never
// auto-re-zeroes.

void startBaselineCapture();      // begin a 30 s collection window on this node
void cancelBaselineCapture();     // stop this node's active collection without changing its saved baseline
void doBaselineSet();             // start here + (on Gateway) broadcast `C` to sensor nodes
void cancelBaselineSet();         // cancel here + (on Gateway) broadcast `X` to sensor nodes
void toggleBaselineSet();         // exact short-press / serial `z` action
void finalizeBaselineCapture();   // called when the window elapses: average + commit
void saveBaselinesToFlash();       // persist to NVS (so a reboot keeps the reference)
void loadBaselinesFromFlash();     // restore at boot (only for physically-present sensors)
bool anyPresentBaseline();          // true if any present sensor has a baseline loaded (drives NVS-empty recovery)

// Collection state (owned here; the loop's completion check reads these).
extern bool          baselineCollecting;
extern unsigned long baselineCollectStart;

#endif
