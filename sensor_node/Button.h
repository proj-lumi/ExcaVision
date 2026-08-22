#ifndef BUTTON_H
#define BUTTON_H

// Debounced button edge detection. Call pollButton() every loop().
// A short press (< SHORT_PRESS_MS) triggers the baseline collection
// (via Baseline::startBaselineCapture). Long-press handling is added
// in a later step.

void pollButton();

#endif
