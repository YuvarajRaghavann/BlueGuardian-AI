# BlueGuardian threat-model training

## Current status

The app currently ships the **BlueGuardian Evidence Heuristic**, not a trained model. This training pipeline is deliberately separate from the Android app and refuses to train from a tiny or unlabeled dataset. Do not replace the heuristic or display training accuracy until a curated dataset has been evaluated and an inference artifact compatible with the app has been reviewed.

## Why an external BLE dataset is not automatically interchangeable

Public research datasets such as [BLEGuard / BLE-SAD](https://github.com/BLEGuard/supplement) and [CICIoMT2024](https://www.unb.ca/cic/datasets/iomt-dataset-2024.html) contain useful BLE/network attack research data, but their packet-level fields are not the same as BlueGuardian's current 11 app-visible features (advertised name, service count, RSSI snapshot, owner trust and connection state). Training a model on unrelated columns and plugging it into the app would be feature leakage or schema mismatch, not a valid improvement.

## Curated CSV format

Use the exact column names in `feature_schema.json`, plus:

- `device_group`: stable pseudonymous ID for a physical device or capture session. Never put owner names, MAC addresses, or other personal identifiers in the training file.
- `label`: reviewed ground truth from a controlled lab test or documented analyst review. Supported labels are listed in the script.
- The 11 features must use the same 0..1 normalization and semantics as `src/ml/featureExtractor.ts`.

Do not label an unknown device as malicious merely because it is unknown. Keep ambiguous observations out of supervised classes until reviewed. Never include the same physical device group in both training and test data.

## Run

From this directory, install the isolated dependencies and use a reviewed dataset:

```bash
python -m venv .venv
# Windows PowerShell: .venv\\Scripts\\Activate.ps1
# Linux/WSL: source .venv/bin/activate
pip install -r requirements.txt
python train_model.py --csv ../data/curated-blueguardian-observations.csv --out output
```

The pipeline creates a local Joblib model and `evaluation.json` containing a device-group-separated hold-out evaluation, per-class precision/recall/F1, confusion matrix, and false-benign rate. The script refuses fewer than 100 rows, missing labels/features, out-of-range normalized values, or too few device groups.

## Release gate

This script does **not** automatically activate the trained model in the Android app. Before integration, export the model to a portable format, verify exact feature parity, test on an untouched dataset split by physical device, inspect false positives/false-benign errors, and run Android inference/performance tests. No training data is bundled here, so no trained model or accuracy claim is fabricated.
