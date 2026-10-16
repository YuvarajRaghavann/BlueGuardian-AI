# BlueGuardian BLE Flood Model: Candidate Review

**Status: trained research candidate. Not production validated. Runtime activation is disabled.**

## Scope

This Random Forest was trained to distinguish benign advertising windows from BLE advertising-flood/spam windows. It is not a general Bluetooth attack classifier and does not identify the owner or maliciousness of any particular device. The model is intended to generate a reviewable environment-level advisory only; it must not automatically block or trust devices.

Dataset: Bluetooth Low Energy (BLE) Dataset: Raw-Capture for Intrusion Analysis, Version 2, DOI 10.17632/ntmmcw6jj8.2, CC BY 4.0: https://data.mendeley.com/datasets/ntmmcw6jj8.2

## Current paired-capture evaluation

Seven PCAPNG capture sessions were grouped by the declared capture scenario. Entire capture sessions were kept disjoint between training and testing. A related randomized-spam capture and a related 100 ms spam capture were present on both sides as separate capture sessions. This estimates session-to-session generalization when the scenario is already represented in training; it is not a test on unseen attack families.

| Metric | Result |
|---|---:|
| Accuracy | 99.448% |
| Balanced accuracy | 99.574% |
| BLE-flood precision | 98.445% |
| BLE-flood recall | 99.979% |
| BLE-flood F1 | 99.206% |
| Benign false-positive rate | 0.831% |
| Held-out 5-second windows | 13,592 |
| Confusion matrix, rows/columns benign then BLE-flood | [[8831, 74], [1, 4686]] |

The declared preliminary limits were false-positive rate at or below 2% and BLE-flood recall at or above 90%. Both passed for this paired-capture split.

## Important counter-result

A separate random whole-session split happened to hold both randomized-MAC spam captures out of training while training contained static-MAC attack captures only. That more difficult unseen-profile test produced 78.41% accuracy, 57.42% BLE-flood recall and 0.62% benign false-positive rate.

This counter-result must be retained alongside the paired-capture result. Do not present the paired-capture metrics as evidence that the model generalizes to unseen attack profiles or to all everyday Bluetooth traffic.

## Android parity is still unproven

The training features come from Nordic sniffer frames decoded by Wireshark/tshark. Android uses OS scan callbacks with different observation and throttling behavior; it does not necessarily report every over-the-air advertising packet. Therefore the feature distributions may differ even though the field names match. Before enabling the classifier, collect benign and controlled-flood windows on the target Android handset, compare per-feature distributions/ranges against training, and run a predeclared physical-device test without tuning on the final holdout.

## Runtime gate

The generated model remains status='candidate' and deploymentStatus='disabled_until_explicit_review'. The inference wrapper only executes after the artifact is explicitly marked validated, deployment is set to enabled_after_review, the recorded metric gates pass, and a review record contains reviewer, timestamp, and a successful handset smoke-test flag. No such review record is present.

## Reproducibility

- Training script: ml_training/run_public_ble_training.py
- Nordic PCAPNG window parser: ml_training/extract_tshark_windows.py
- Trainer/evaluator: ml_training/train_ble_flood_model.py
- Full metrics/provenance: ml_training/reports/ble_flood_evaluation.json (CI artifact)
- Candidate tree ensemble: src/ml/generated/bleFloodModel.json

The workflow downloads the source archive at run time, processes it in temporary runner storage, and uploads only aggregate window features, evaluation report and disabled candidate weights. Raw packet captures are not committed.
