# BlueGuardian BLE Flood Model Training

This pipeline is the first real-data ML track for BlueGuardian: **benign BLE advertising vs. BLE advertising-flood/spam behaviour**. It does not claim to detect every Bluetooth attack, spoofing in general, malware, or unauthorized pairing. A separate labeled dataset and feature design are required for those classes.

## Why this is separate from the existing model

The current 11-feature BlueGuardian Development Heuristic describes a single device snapshot. Packet-flood detection needs temporal observations. This pipeline uses a 5-second window feature schema that can be extracted from PCAP captures and calculated on Android from native scan observations:

1. `observation_count`: advertising reports/packets recorded in the window.
2. `observations_per_second`: reports divided by the actual window duration.
3. `unique_addresses`: distinct advertiser addresses in the window.
4. `unique_address_fraction`: distinct addresses divided by address-bearing observations.
5. `max_address_fraction`: highest per-address observation count divided by address-bearing observations.
6. `rssi_mean`: mean RSSI when present; missing values are imputed from training data.
7. `rssi_std`: RSSI standard deviation when at least two RSSI observations exist; missing values are imputed from training data.
8. `rssi_observation_fraction`: fraction of reports that include a usable RSSI value.

**Important telemetry difference:** a phone's Android BLE scanner does not necessarily report every over-the-air packet. Training PCAP windows and Android feature windows must use comparable collection conditions; the model is not eligible for deployment merely because the training script succeeds.

## Dataset sources

- BLE Raw-Capture Dataset for Intrusion Analysis, Mendeley Data, Version 2, DOI 10.17632/ntmmcw6jj8.2, CC BY 4.0: https://data.mendeley.com/datasets/ntmmcw6jj8/2. Includes benign ambient and BLE spam sessions, including randomized addresses. Cite the dataset in project outputs.
- CICIoMT2024, Canadian Institute for Cybersecurity: https://www.unb.ca/cic/datasets/iomt-dataset-2024.html. Its Bluetooth attack contribution is BLE denial of service; it is not a general Bluetooth attack taxonomy.
- BLEGuard / BLE-SAD research sample: https://github.com/BLEGuard/supplement. Its reported results describe that research system, not BlueGuardian.

Do not commit raw PCAPs, downloaded research datasets, or personal device captures to this repository. Keep them outside Git in `ml_training/data/raw/`.

## Environment setup

From the repository root, in a separate Python environment:

```bash
python -m venv .venv-ml
# Windows: .venv-ml\\Scripts\\activate
# Linux / WSL: source .venv-ml/bin/activate
python -m pip install -r ml_training/requirements.txt
```

## Data manifest and real capture extraction

The public dataset's PCAPNGs use the Nordic nRF Sniffer format. Scapy reads these files as raw payloads and does not expose the advertisement fields, so use Wireshark's `tshark` dissector. The CI training workflow installs `tshark` and runs the entire real-data pipeline via `run_public_ble_training.py`.

```bash
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y tshark
python -m pip install -r ml_training/requirements.txt
python ml_training/run_public_ble_training.py
```

The workflow downloads the public dataset into temporary runner storage, reads the nested capture ZIP, extracts only the seven documented captures into a temporary directory, filters advertising frames with `btle.advertising_address`, and reads RSSI through `nordic_ble.rssi`. It emits aggregate five-second windows and then invokes the trainer. No raw captures are committed to Git or uploaded as artifacts. Capture-to-label and capture-to-session mappings are explicit in `run_public_ble_training.py` and recorded in the report provenance.

For manually prepared PCAPs compatible with Scapy's standard BLE dissectors, `extract_pcap_windows.py` remains available. The actual Mendeley Nordic capture pipeline uses `extract_tshark_windows.py`.

## Train and evaluate

For a pre-extracted feature CSV, run the trainer independently:

```bash
python ml_training/train_ble_flood_model.py \
  --data ml_training/processed/ble_windows.csv \
  --model-output src/ml/generated/bleFloodModel.json \
  --report-output ml_training/reports/ble_flood_evaluation.json
```

The trainer holds out whole `session_id` groups, rejecting a split that leaves a class absent from train or test. It reports confusion matrix, precision, recall, F1, balanced accuracy, and benign false-positive rate. Adjacent windows from a single capture never appear in both train and test.

The exported JSON is marked `candidate`, not `validated`. The mobile inference wrapper must ignore candidate/untrained artifacts. Review false positives on new devices, collection conditions and an untouched holdout before an explicit promotion decision. No training report or model artifact should be described as production validated until the report and hardware acceptance tests support that claim.

## Limitations / research integrity

- A high-frequency flood dataset supports a BLE flood detector, not a generic classifier for spoofing, pairing attacks or malicious intent.
- Accuracy from papers or third-party implementations does not transfer to BlueGuardian.
- Synthetic samples can test code but are not included as evidence of real-world detection accuracy.
- If PCAPs lack advertiser addresses or usable timestamps, the extractor fails rather than fabricating address- or time-based features.
