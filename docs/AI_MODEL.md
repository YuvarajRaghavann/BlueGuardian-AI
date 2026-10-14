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

## 2. Feature Vector (`src/ml/featureExtractor.ts`)

Deterministic 11‑dimensional numeric vector extracted from a `BluetoothDevice`.

| Index | Feature | Normalisation / Range | Description |
|------|---------|----------------------|-------------|
| 0 | `normalizedTrustScore` | 0‑1 | `trustScore / 100` |
| 1 | `normalizedRSSI` | 0‑1 | Linear map of RSSI from –30 dBm (1) to –100 dBm (0) |
| 2 | `knownFlag` | 0/1 | `device.isKnown` |
| 3 | `trustedFlag` | 0/1 | `device.trusted` |
| 4 | `blockedFlag` | 0/1 | `!trusted && riskLevel === 'high'` |
| 5 | `serviceCountNorm` | 0‑1 | `min(1, services.length / 10)` |
| 6 | `securityFlagCountNorm` | 0‑1 | Count of (unknown, high‑risk, no address, unknown connection) / 5 |
| 7 | `suspiciousNameFlag` | 0/1 | Regex match against known suspicious patterns |
| 8 | `connectionStatusFlag` | 0‑1 | connected = 1, connecting = 0.5, else = 0 |
| 9 | `deviceTypeRisk` | 0‑1 | Fixed per `DeviceType` (smartphone 0.1 … unknown 0.8) |
|10| `discoverySourceFlag` | 0/1 | REAL = 1, SIMULATED = 0 |

The order **must** stay identical for any future model.

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

## 4. Development Model (`src/ml/developmentModel.ts`)

* **Name**: `BlueGuardian Development Classifier`
* **Version**: `0.1.0-demo`
* **Status**: `DEMO` (see `MLModelStatus`)

Deterministic, rule‑based pseudo‑ML that maps the feature vector to one of six classes using weighted heuristics and a fixed hash‑based tie‑breaker. **No randomness**, same input → same output. Clearly labelled *development* everywhere (UI badges, logs, documentation). Not a trained statistical model.

### Classification Classes (`MLThreatClass`)

| Class | Meaning |
|-------|---------|
| `BENIGN` | No notable risk indicators |
| `SUSPICIOUS` | Low trust / unknown device / suspicious name |
| `POTENTIAL_SPOOFING` | Unusually strong RSSI, high device‑type risk |
| `POTENTIAL_UNAUTHORIZED_ACCESS` | Unknown, untrusted, many security flags |
| `ANOMALOUS_BEHAVIOR` | Unusual signal, unknown connection state |
| `HIGH_RISK_DEVICE` | Blocked / high‑risk flag, very low trust |

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

## 7. Security Assessment Integration (`src/utils/securityAssessment.ts`)

Combines three scores:

```
finalThreatScore = 0.60 * ruleBasedThreatScore + 0.40 * mlRiskScore
```

* **Rule weight (0.60)** and **ML weight (0.40)** are **development integration weighting** – not scientifically validated.
* `mlRiskScore` maps ML class × confidence to 0‑100.
* Final severity derived from final score (same thresholds as rule engine).
* `confidence` = weighted avg of rule certainty (ruleScore/100) and ML confidence.
* All reasons (rule + ML) merged for explainability.

Output `SecurityAssessment` feeds `ThreatContext` to create enriched `Threat` objects (now carry optional `mlPrediction`, `finalClassification`, `confidence`, `modelName`, `modelVersion`).

---

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

## 13. Replacing with a Real Trained Model (Future)

1. Train a model (e.g. TensorFlow.js, ONNX Runtime Web, or server‑side API) on a curated Bluetooth‑telemetry dataset with ground‑truth threat labels.
2. Export model artefacts.
3. Implement a new class `RealModel implements ThreatClassificationModel` that loads artefacts and runs `predict`.
4. Register via `registerModel('production', RealModel)` in `modelRegistry`.
5. Call `initializeModel('production')` at startup (or via Settings UI).
6. All UI, assessment logic, and context remain unchanged – they depend only on the interface.

No retraining of the development model, no fake metrics, no hard‑coded assumptions beyond the feature contract.

---

## 14. Current Limitations

* Development model is heuristic, not learned.
* Feature set limited to data available in browser Web Bluetooth.
* No temporal / behavioural sequencing (single‑snapshot).
* Confidence calibration not performed.
* No persistent storage of model versions / predictions.
* No backend – all inference runs client‑side.

---

*Document version 1.0 – aligned with Phase 4 codebase (commit <hash>).*