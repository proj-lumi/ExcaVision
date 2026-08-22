# ML Spec — Shoring anomaly detection (Rung 2: XGBoost forecaster)

> The predictive-model subsystem. Server-side Python, not on the node. Reads
> tilt time-series from the backend, learns "normal," flags departures from
> normal as early warnings. This is the honest, beginner-achievable version
> of "predictive early warning" — unsupervised anomaly detection, because
> labeled collapse data doesn't exist for shoring.
> Cross-refs: [BACKEND_SPEC.md](./BACKEND_SPEC.md) (data source + risk_scores
> table), [NODE_SPEC.md](./NODE_SPEC.md) (what the node emits),
> [MOBILE_APP_SPEC.md](./MOBILE_APP_SPEC.md) (where risk scores are shown).

## 1. Problem framing (be honest about this)

We have **no labeled collapse data** — shoring failures are rare and we won't
collect enough to train a "recognize a collapse" supervised model. So the
legitimate framing is:

> **Learn what "normal" looks like from weeks of normal operation, then flag
> when the readings stop looking normal.**

This is **unsupervised time-series anomaly detection via forecasting**: train
a model to predict the next tilt reading from recent history; if the real
reading is way off the prediction, something's changing. The model *learned*
the wall's normal behavior (including diurnal temperature drift, slow
settling noise, etc.); a departure from that learned pattern is the early
warning.

This is a real, defensible ML approach. It is **not** a threshold in
disguise — the model learned the pattern. It's also honestly limited: it
detects "stopped behaving normally," not "will collapse in 2 hours." Managing
that expectation with stakeholders is part of the job.

## 2. The maturity ladder (build in order, stop when good enough)

### L0 — Statistical safety net (always on, the floor that never breaks)
- Compute the normal range of tilt and tilt-rate from collected data.
- Alert when readings leave that range for a sustained window.
- Is it "AI"? No — it's statistics. But it's the **baseline every fancier
  model must beat**, it ships the always-on raw alarm, and building it
  forces you to learn your own data (noise levels, temperature drift,
  what's a real movement).
- **Ship this first. It stays active forever, even after L1 ships.**

### L1 — XGBoost forecaster (the headline deliverable, "Rung 2")
- Train XGBoost to predict the next tilt reading from engineered features.
- Anomaly score = how far the real reading is from the prediction, sustained
  over a window.
- **This is the ML that satisfies "ML is a huge criteria."** Defensible,
  explainable ("model predicted 0.03°, the wall did 0.8°, anomalous"),
  genuinely learned.
- See §3–§6.

### L2 — Reconstruction / probabilistic (only if L1 underperforms)
- **PCA** (easy unsupervised ML, great stepping stone) or an
  **LSTM/TCN autoencoder** (advanced) on normal windows; bad reconstruction
  = anomaly.
- **Gaussian Process / Bayesian online change-point detection** for
  calibrated regime-change detection with honest uncertainty.
- Do **not** start here. Reach for it only after L1 is proven and you have a
  specific gap to fill.

### L3 — Semi-supervised (long-term, if labels ever accumulate)
- As lab/simulated failure data or engineer-labeled near-misses accumulate,
  graduate toward true failure prediction. Honestly gated on getting some
  labels eventually. Not in scope for now.

## 3. Features (the most important part — good features beat fancy models)

The node sends `tilt` per sensor per second. The ML derives everything else
**server-side** (never on the node):

- **Lagged tilts:** tilt at t-1, t-2, … t-N (the recent history the forecaster
  reads). N ≈ 60 for a 1-min-history window at 1 s, or 60 at 1-min for the
  long model.
- **Rate:** `tilt_now − tilt_prev` (first derivative). The earliest whisper
  of movement — tilt alone might still be tiny, but rate jumps immediately.
- **Acceleration:** `rate_now − rate_prev` (second derivative). The
  "it's getting worse faster" signal — the strongest early-warning predictor.
- **Temperature:** the MPU6050's die temp. Lets the model learn the diurnal
  bias drift so a hot afternoon doesn't false-alarm.
- **Time-of-day:** captures the diurnal pattern explicitly.
- **Multi-sensor agreement:** across the sensors on a node (or across nodes
  on a rigid wall), are they moving together? Real wall events move all
  sensors together; a single-sensor jump is a mount/data glitch. This is a
  built-in false-alarm suppressor and a genuine model feature.

**Why rate/acceleration matter so much:** movement *is* rate of change. A
model trained on tilt alone is blind to the *start* of movement (the tilt
value is still small); a model trained on tilt + rate + acceleration sees
the dynamics and can learn "rate climbing + acceleration positive = the next
readings will probably keep climbing." That's the precursor you want.

## 4. Data sources

- **Training (offline):** `readings_1min` (the downsampled long-term table
  from [BACKEND_SPEC.md §5](./BACKEND_SPEC.md)) — weeks of normal operation.
  One model per site (or per node, fine-tuned), trained on pooled normal
  data from all that site's sensors.
- **Inference (live):** the recent window of `readings` (1 s raw) or
  `readings_1min` (1 min), depending on the latency you want. Start with
  1-min inference (cheap, fine for a slow signal); move to 1-s if you need
  faster early warnings.

## 5. Training (offline, in a Jupyter notebook)

1. **Collect** 1–2 weeks of normal operation into a pandas DataFrame (read
   straight from Supabase/Postgres, or a CSV export).
2. **Engineer features:** lagged tilts, rate, acceleration, temperature,
   time-of-day, agreement. (This is the real work — spend most of your time
   here.)
3. **Frame as supervised regression:** `y = tilt at t`, `X = features at t`.
   (Even though the *task* is unsupervised anomaly detection, the *model* is
   a supervised forecaster trained on normal data only.)
4. **Train/test split** temporally (last 20% as test, no shuffling — time
   series).
5. **Train XGBoost** (`xgboost.XGBRegressor`). Tune lightly
   (`max_depth`, `n_estimators`, `learning_rate`) with time-series CV.
6. **Evaluate on held-out normal data + synthetic anomalies** (see §7).
7. **Save** the trained model to a file (joblib/xgboost native). Tag with a
   version string → goes into `risk_scores.model_version` at inference.

Tool stack: **Python + Jupyter + pandas + scikit-learn + XGBoost +
matplotlib.** All runs on a laptop. No GPUs, no neural nets, no pain. This is
the workhorse stack of real-world ML and it's beginner-accessible.

## 6. Inference (live, a scheduled Python script)

A cron job (every minute to start):

1. **Load** the saved model (by `model_version`).
2. **Read** the last hour of `readings` (or `readings_1min`) for each node.
3. **Build the same features** as training (lagged tilts, rate, etc.).
4. **Predict** the next tilt; compare to the actual reading that just
   arrived.
5. **Compute anomaly score** = `|actual − predicted|`, normalized and
   smoothed over a short window (so one off prediction doesn't alarm; a
   sustained run of off predictions does).
6. **Write** a row to `risk_scores`: `(ts, node_id, predicted_tilt,
   actual_tilt, anomaly_score, model_version)`.
7. **(Optional, later)** if score > threshold → insert an `alerts` row of
   `kind = model-warning`.

The model never runs inside the app or the node. It's a scheduled script that
writes a number to a table. The app reads that number like any other sensor
value. That separation keeps the model agile (retrain/swap without
reflashing devices) and the app/node simple.

## 7. Evaluation — how you prove it works without real collapses

You can't wait for a wall to fail. So you **fake it**:

1. **Take real normal data** from your collection.
2. **Inject synthetic anomalies** — paste in realistic failure trajectories:
   - a slow creep (tilt rising steadily over an hour),
   - a sudden jump (tilt steps up 1° in one reading),
   - an acceleration (rate increasing over time),
   - a drift + settle (moved, then stopped — should *not* alarm as ongoing).
3. **Measure:** does the model catch each? How quickly (detection latency)?
   How many false alarms on clean normal data (FP rate)?
4. **Compare models** (L0 vs L1 vs L2) on these metrics. Model selection is
   part of the deliverable.
5. **Report numbers** like "catches a simulated 1° creep within 3 minutes,
   with 1 false alarm per week." That's a real, presentable result.

This is a completely standard ML evaluation technique for rare-event
detection. It's how you demonstrate the model on a capstone/review without
needing a real collapse.

If you can ever get **lab/simulated failure data** (run a small shoring rig
toward failure in a controlled test), that becomes your real test set and
vastly strengthens the credibility. Plan it if feasible; don't block on it.

## 8. MLOps (light, but real)

- **Model registry:** MLflow (or even a folder of dated model files + a
  `model_version` string). Lets you version, compare, and roll back models.
- **Retraining loop:** retrain monthly or when new normal data accumulates.
  Each retrain → new `model_version` → inference script picks it up.
- **Monitoring:** watch the live `risk_scores` distribution. If the model
  starts firing constantly, either the wall is actually failing or the model
  has drifted (retrain). If it never fires, either everything's fine or the
  model is numb (check against L0).
- **Engineer feedback:** every alert gets acknowledged in the app with an
  optional note ("false alarm — hot day" / "real — inspected, post
  re-zeroed"). These labels are gold for future L3 semi-supervised work.

## 9. What the ML does NOT do

- It does not run on the node. The node only streams tilt.
- It does not replace the local threshold alert (L0 + the node's own check
  are the safety floor; the model is a slower early-warning layer on top).
- It does not predict collapse time-to-failure (no labels). It flags
  "departed from learned-normal."
- It does not do user auth or own the data — it reads/writes the backend.

## 10. Decisions to make before building

1. **Who owns this workstream?** It's its own branch (`feat/model`) parallel
   to `feat/sensor` and `feat/transport`. One person with a laptop, Jupyter,
   scikit-learn, XGBoost can do L0 + L1.
2. **Inference cadence:** 1 min (cheap, fine for shoring) or 1 s (faster
   early warning, more compute)? Start at 1 min.
3. **Per-site vs per-node models:** one model per site (pooled, more data) or
   per-node (specialized, less data)? Start per-site; fine-tune per-node if
   needed.
4. **Where does inference run?** A small always-on cloud box (a $5/mo VPS)
   running the cron script, or a laptop that's always on during the project.
   The node doesn't run the model; this does.
5. **Is any lab/simulated failure data possible?** Even a small-scale
   shoring-to-failure test transforms the ML credibility. Plan early if yes.

## 11. Prerequisite (non-negotiable)

**You cannot do ML without data.** The prerequisite for L1 training is:
deploy nodes → stream normal readings into `readings`/`readings_1min` for
~1–2 weeks → then train. Until that data exists, only L0 (raw threshold, from
the node + simple server-side bounds) is active. The timeline is: ship node →
collect → train L1 → go live with ML.
