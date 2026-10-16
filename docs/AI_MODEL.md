# BlueGuardian AI – Phase 4: AI/ML Threat Classification Architecture

## 1. Phase 4 Objective
Add an AI/ML classification layer on top of the existing rule‑based threat engine (Phase 3). The final security pipeline becomes:

```
Bluetooth Device
      ↓
Feature Extraction
      ↓
Trust Score
      ↓
Rule‑Based Threat Analysis
      ↓
AI/ML Threat Classification
      ↓
Combined Security Assessment
      ↓
Threat Score + Classification + Confidence
      ↓
Recommended Action
```

The ML layer classifies Bluetooth security behaviour into meaningful threat categories while keeping the rule‑based engine fully explainable.

---

## 2. Feature Vector (src/ml/featureExtractor.ts)

The feature vector remains 11 dimensions for interface compatibility. The semantics now avoid treating missing metadata as attack evidence.

| Index | Feature | Range | Meaning |
|------|---------|-------|---------|
| 0 | normalizedTrustScore | 0-1 | Trust score / 100 |
| 1 | normalizedRSSI | 0-1 | Single observed RSSI value; not standalone spoofing evidence |
| 2 | knownFlag | 0/1 | Owner history |
| 3 | trustedFlag | 0/1 | Explicit trust setting |
| 4 | explicitlyBlockedFlag | 0/1 | BlueGuardian block flag only |
| 5 | serviceCountNorm | 0-1 | Normalized number of observed services; absence is not proof of attack |
| 6 | independentSecurityIndicatorCountNorm | 0-1 | Explicit block, suspicious name, unstable connection, degraded connection / 4 |
| 7 | suspiciousNameFlag | 0/1 | Obvious suspicious-term heuristic; not ground truth |
| 8 | connectionStatusFlag | 0-1 | Reported connection state, with unknown kept neutral |
| 9 | deviceTypeRisk | 0-1 | Low-weight prior; unknown type is neutral, not high threat |
| 10 | discoverySourceFlag | 0/1 | REAL=1, SIMULATED=0 |

Keep this order stable for model compatibility. These are engineering features, not proof that a device is malicious.

---

## 3. Model Interface (`src/ml/model.ts`)

```ts
interface ThreatClassificationModel {
  name: string;
  version: string;
  predict(features: number[]): MLPrediction;
}
```

* `MLPrediction` (see types) contains:
  * `label: MLThreatClass`
  * `confidence: number (0‑1)`
  * `modelName, modelVersion, predictedAt, featuresUsed[], explanation`

All concrete models implement this interface, allowing drop‑in replacement.

---

## 4. Evidence-Based Development Heuristic (src/ml/developmentModel.ts)

* **Name**: BlueGuardian Evidence Heuristic
* **Version**: 0.2.0-heuristic
* **Status**: Development baseline

The hash-based pseudo-random class picker has been removed. The baseline makes a deterministic, explainable decision from explicit evidence such as an explicit in-app block, a suspicious advertised name, or corroborating independent indicators. A new/unknown device is unverified, not malicious solely because manufacturer/type/history is missing. One RSSI sample is not treated as spoofing evidence. This remains a rules-based heuristic, **not a trained statistical model**. Its displayed confidence is evidence strength, not a calibrated probability or measured accuracy.

### Classification Classes (MLThreatClass)

| Class | Meaning |
|-------|---------|
| BENIGN | No strong positive threat evidence in this observation; unknown devices may still require manual approval |
| SUSPICIOUS | An advertised name contains a suspicious term; not proof of an attack |
| POTENTIAL_SPOOFING | Reserved class; a single RSSI snapshot is not sufficient to assert spoofing |
| POTENTIAL_UNAUTHORIZED_ACCESS | Multiple independent indicators support additional review |
| ANOMALOUS_BEHAVIOR | Reserved for stronger behavioral/temporal evidence |
| HIGH_RISK_DEVICE | Explicitly blocked device or other corroborated high-risk evidence |

---

## 5. Model Service (`src/ml/mlService.ts`)

* `initializeModel(key?)` – loads selected model (currently only `development`).
* `getModelStatus()` – returns `{status, error?, currentModel}`.
* `classifyDevice(device)` – runs feature extraction + model.predict.
* `classifyDevices(devices[])` – batch.
* `availableModels()` – registry keys.

Future TensorFlow.js / ONNX / Python‑API models can be registered via `modelRegistry.ts` without touching UI code.

---

## 6. Model Registry (`src/ml/modelRegistry.ts`)

Simple map `key → ModelConstructor`. `registerModel`, `getModel`, `listModels`. Development model pre‑registered.

---

## 7. Security Assessment Integration

The existing rule/heuristic blend remains development integration logic. Its weights and thresholds have not been trained or empirically calibrated, so its values must not be described as validated attack probability or model accuracy. Unknown/new devices still go through an approval gate, but are not pushed into the active Threats list solely for being unknown.

## 8. Explainability

Every ML prediction returns an `explanation` string listing the feature‑level drivers (e.g. “low trust score, device not known, unusually strong signal”). UI surfaces this in Threat Detail and Device Detail modals. No claim of “AI confirmed malicious”.

---

## 9. UI Integration

| Component | New ML UI |
|-----------|-----------|
| **Dashboard** | “AI Security Analysis” panel with model status, devices classified, high‑risk ML count, avg confidence; disclaimer banner. |
| **Threats page** | Threat cards show compact “AI: CLASS (XX% confidence)”. Threat detail modal adds full “AI/ML Analysis” section. |
| **Device detail** | If any associated threat has ML, shows AI/ML Classification section with model, version, class, confidence, explanation. |
| **Settings** | AI/ML Configuration panel – model name, version, status, classes, feature count, registered models, development badge. |
| **Analytics** | ML metrics cards, classification distribution table, threat severity distribution. |

All simulated devices remain labelled `SIMULATED`; ML predictions on them are also marked development.

---

## 10. Confidence Interpretation (UI thresholds)

| Confidence | Label |
|------------|-------|
| ≥ 0.80 | High confidence |
| 0.60‑0.79 | Moderate confidence |
| < 0.60 | Low confidence |

These are **UI interpretation thresholds only**, not statistically validated.

---

## 11. Simulation & Real Bluetooth Modes

* **Simulation** – devices generated by `bluetoothSimulator`; they flow through full pipeline, predictions carry `discoverySource: 'SIMULATED'` and development badge.
* **Real Web Bluetooth** – only data actually available from `navigator.bluetooth` is used; missing fields default gracefully. No passive scanning, no physical‑attack claims.

---

## 12. Testing Checklist (deterministic)

1. Feature extraction returns identical vector for same device.
2. Known trusted device → `BENIGN` with high confidence.
3. Unknown device → `SUSPICIOUS` / `HIGH_RISK_DEVICE` depending on flags.
4. Low‑trust device → elevated rule + ML scores.
5. Suspicious name → `SUSPICIOUS` flag.
6. High‑risk device → `HIGH_RISK_DEVICE`.
7. Same input → identical prediction (hash‑based determinism).
8. Confidence always 0‑1.
9. Combined final score 0‑100.
10. Missing optional device fields do not crash.
11. ML unavailable state handled (fallback to rule‑only).
12. Phase 3 threat generation still works without ML.
13. Simulated devices stay labelled simulated.

*No accuracy/precision/recall/F1/ROC‑AUC numbers are claimed – they require a real labelled dataset and evaluation pipeline.*

---

## 13. Replacing the Heuristic with a Trained Model

The current BlueGuardian Evidence Heuristic is not trained, and no real-world accuracy/precision/recall/F1 numbers are available. Do not claim top accuracy until the model has been trained and evaluated on independent labeled observations.

1. Collect lawful, curated Bluetooth telemetry with independent ground-truth labels for benign device families, controlled lab attacks, and ambiguous/unknown cases. Do not label every unknown device as malicious.
2. Freeze a documented feature schema and label policy. Record collection conditions and which values are unavailable on particular Android versions or device families.
3. Split by physical device/family and collection session to reduce train/test leakage; fit preprocessing and tune thresholds on training/validation data, then keep an untouched test set.
4. Compare simple baselines before complex models. Report per-class precision, recall, F1, false-positive rate, confusion matrix, calibration, and device-family slices. Accuracy alone can hide a model that flags most ordinary devices.
5. Select a threshold that meets a predefined false-positive budget while retaining high recall for validated attack classes.
6. Export trained model artifacts and implement a real classifier that satisfies the ThreatClassificationModel interface.
7. Register the implementation in modelRegistry.ts and enable it only after held-out evaluation passes acceptance criteria. Keep the heuristic as a transparent fallback.

Synthetic data may validate a training pipeline and code path, but it cannot establish real-world Bluetooth threat-detection accuracy.

## 14. Current Limitations

* Development model is heuristic, not learned.
* Feature set limited to data available in browser Web Bluetooth.
* No temporal / behavioural sequencing (single‑snapshot).
* Confidence calibration not performed.
* No persistent storage of model versions / predictions.
* No backend – all inference runs client‑side.

---

*Document version 1.0 – aligned with Phase 4 codebase (commit <hash>).*