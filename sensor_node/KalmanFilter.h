#ifndef KALMAN_FILTER_H
#define KALMAN_FILTER_H

class KalmanFilter {
public:
  KalmanFilter(float processNoise = 0.01, float measurementNoise = 4.0);
  float update(float measurement);

private:
  float q; // process noise - how much we trust the system can change per step
  float r; // measurement noise - how much we trust each raw reading
  float p; // estimation error covariance
  float x; // current filtered estimate
  bool initialized;
};

#endif
