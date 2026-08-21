#include "KalmanFilter.h"

KalmanFilter::KalmanFilter(float processNoise, float measurementNoise)
  : q(processNoise), r(measurementNoise), p(1.0), x(0.0), initialized(false) {}

float KalmanFilter::update(float measurement) {
  if (!initialized) {
    x = measurement; // seed with the first real reading instead of 0
    initialized = true;
    return x;
  }

  // Prediction step (angle doesn't change on its own without motion input)
  p = p + q;

  // Update step
  float k = p / (p + r); // Kalman gain
  x = x + k * (measurement - x);
  p = (1 - k) * p;

  return x;
}
