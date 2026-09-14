# ML Spec

ML is the October product's server-side early-warning layer. It does not replace
the node's local threshold alarm.

## Honest goal

There is no labeled collapse dataset. The model may report **departure from
learned normal behavior**; it must not claim to predict collapse time.

Warnings are evaluated and delivered directly to the customer's configured
contacts. No manual ExcaVision review is required for every threshold or model
warning. Acknowledgement is an optional record in the app, not a gate on alert
delivery.

## Build order

1. Collect at least 1–2 weeks of normal data.
2. Ship a statistical baseline using tilt and tilt-rate bounds.
3. Train an XGBoost next-reading forecaster on normal periods.
4. Define anomaly score from sustained prediction error.
5. Write results to `risk_scores` for the app.

Do not start with neural networks.

## Features

- recent tilt values;
- tilt rate and acceleration;
- temperature and time of day;
- agreement between sensors.

Never build a feature window across a baseline reset. Each baseline period is
a separate training and inference segment.

## Evaluation

Use held-out normal data plus synthetic creep, jump, acceleration, and
move-then-settle cases. Report detection latency and false alarms. The ML model
ships only if it improves on the statistical baseline.

## Runtime

A scheduled Python service reads recent Supabase data, computes features,
loads a versioned model, and inserts `risk_scores`. Start with one-minute
inference and one model per site.

## Permanently excluded from the October product

- ML on the ESP32;
- collapse-time prediction;
- automatic safety actions from the model;
- training before enough real data exists.
