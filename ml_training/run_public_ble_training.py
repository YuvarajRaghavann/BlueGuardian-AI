#!/usr/bin/env python3
"""Download the published BLE capture archive and run the session-held-out model pipeline."""
from __future__ import annotations

import csv
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

from extract_pcap_windows import FEATURE_COLUMNS, extract_capture

ROOT = Path(__file__).resolve().parents[1]
DOWNLOAD_URL = "https://data.mendeley.com/public-api/zip/ntmmcw6jj8/download/2"
MAX_DOWNLOAD_BYTES = 1_000_000_000
WINDOW_SECONDS = 5.0

# Labels are based on the dataset's public capture description and filenames,
# not inferred from packet features. Each capture is kept as one group at split time.
CAPTURE_LABELS = {
    "BLE_Advertisment_NOspam_12hr.pcapng": ("benign", "benign_extended_12hr"),
    "Baseline_NoAttacker_1hr.pcapng": ("benign", "benign_static_1hr"),
    "BLE_Advertisment_spam_6hr_capture1.pcapng": ("ble_flood", "spam_randomized_6hr_01"),
    "BLE_Advertisment_spam_6hr_capture2.pcapng": ("ble_flood", "spam_randomized_6hr_02"),
    "Attacker_100ms_1hr_01.pcapng": ("ble_flood", "spam_static_mac_100ms_01"),
    "Attacker_100ms_1hr_02.pcapng": ("ble_flood", "spam_static_mac_100ms_02"),
    "Attacker_20ms_1hr.pcapng": ("ble_flood", "spam_static_mac_20ms"),
}


def download_file(destination: Path, url: str, limit: int) -> tuple[int, str]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "BlueGuardian-BLE-Research-Training/1.0",
            "Accept": "application/zip,application/octet-stream,*/*",
        },
    )
    digest = hashlib.sha256()
    written = 0
    with urllib.request.urlopen(request, timeout=240) as response:
        expected = response.headers.get("Content-Length")
        if expected and expected.isdigit() and int(expected) > limit:
            raise RuntimeError(f"Download size {expected} exceeds configured limit {limit}.")
        with destination.open("wb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > limit:
                    raise RuntimeError(f"Download exceeded configured {limit}-byte limit.")
                output.write(chunk)
                digest.update(chunk)
    return written, digest.hexdigest()


def copy_zip_member(archive: zipfile.ZipFile, member: zipfile.ZipInfo, destination: Path) -> str:
    digest = hashlib.sha256()
    with archive.open(member) as source, destination.open("wb") as output:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)
            digest.update(chunk)
    return digest.hexdigest()


def find_capture_members(archive: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    found: dict[str, zipfile.ZipInfo] = {}
    for member in archive.infolist():
        if member.is_dir():
            continue
        name = PurePosixPath(member.filename).name
        if name in CAPTURE_LABELS:
            if name in found:
                raise RuntimeError(f"Duplicate capture basename found in archive: {name}")
            found[name] = member
    missing = sorted(set(CAPTURE_LABELS) - set(found))
    extra = sorted(set(found) - set(CAPTURE_LABELS))
    if missing or extra:
        raise RuntimeError(
            f"Capture mapping mismatch. Missing={missing}; unexpected mapped files={extra}. "
            "Inspect the source archive before assigning labels."
        )
    return found


def write_features(rows: list[dict], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "capture_path", "session_id", "label", "window_index", "window_start_seconds",
        "window_seconds", *FEATURE_COLUMNS, "address_coverage",
    ]
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def annotate_provenance(report_path: Path, model_path: Path, outer_sha: str, inner_sha: str, capture_rows: list[dict]) -> None:
    provenance = {
        "name": "Bluetooth Low Energy (BLE) Dataset: Raw-Capture for Intrusion Analysis",
        "doi": "10.17632/ntmmcw6jj8.2",
        "url": "https://data.mendeley.com/datasets/ntmmcw6jj8/2",
        "licence": "CC BY 4.0",
        "archive_sha256": outer_sha,
        "nested_capture_archive_sha256": inner_sha,
        "labels": {
            "benign": "Dataset-described no-spam/ambient baseline captures",
            "ble_flood": "Dataset-described BLE spam / attacker captures",
        },
        "capture_manifest": capture_rows,
        "window_seconds": WINDOW_SECONDS,
        "feature_schema": FEATURE_COLUMNS,
    }
    report = json.loads(report_path.read_text(encoding="utf-8"))
    report["dataset_provenance"] = provenance
    report["deployment_note"] = (
        "Offline research candidate only. PCAP/Nordic-sniffer observations are not identical "
        "to Android scanner callbacks. Validate Android feature parity and false-positive rate "
        "on physical handsets before any deployment."
    )
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")

    model = json.loads(model_path.read_text(encoding="utf-8"))
    model["trainingData"] = provenance
    model["deploymentStatus"] = "disabled_until_explicit_review"
    model["status"] = "candidate"
    model_path.write_text(json.dumps(model, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def main() -> int:
    output_dir = ROOT / "ml_training" / "processed"
    reports_dir = ROOT / "ml_training" / "reports"
    features_csv = output_dir / "ble_windows.csv"
    model_path = ROOT / "src" / "ml" / "generated" / "bleFloodModel.json"
    report_path = reports_dir / "ble_flood_evaluation.json"
    output_dir.mkdir(parents=True, exist_ok=True)
    reports_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="blueguardian-ble-train-") as tmp_dir:
        temp = Path(tmp_dir)
        outer_path = temp / "outer-download.zip"
        outer_bytes, outer_sha = download_file(outer_path, DOWNLOAD_URL, MAX_DOWNLOAD_BYTES)
        if not zipfile.is_zipfile(outer_path):
            raise RuntimeError("Mendeley public download route did not return a ZIP archive.")

        with zipfile.ZipFile(outer_path) as outer:
            zip_members = [
                member for member in outer.infolist()
                if not member.is_dir() and member.filename.lower().endswith("ble_datasets.zip")
            ]
            if len(zip_members) != 1:
                raise RuntimeError(
                    f"Expected exactly one nested BLE_Datasets.zip, found {len(zip_members)}."
                )
            inner_path = temp / "BLE_Datasets.zip"
            inner_sha = copy_zip_member(outer, zip_members[0], inner_path)

        if not zipfile.is_zipfile(inner_path):
            raise RuntimeError("Nested BLE_Datasets.zip is not a valid ZIP archive.")

        rows: list[dict] = []
        manifest_details = []
        raw_dir = temp / "raw-captures"
        raw_dir.mkdir()
        with zipfile.ZipFile(inner_path) as captures:
            members = find_capture_members(captures)
            for basename, (label, session_id) in CAPTURE_LABELS.items():
                pcap_path = raw_dir / basename
                copy_zip_member(captures, members[basename], pcap_path)
                print(f"Extracting features: {basename} label={label} session={session_id}", flush=True)
                capture_rows = extract_capture(
                    pcap_path,
                    label=label,
                    session_id=session_id,
                    window_seconds=WINDOW_SECONDS,
                    max_packets=0,
                )
                for row in capture_rows:
                    # Do not preserve runner-specific absolute paths in the processed dataset.
                    row["capture_path"] = basename
                rows.extend(capture_rows)
                manifest_details.append({
                    "capture": basename,
                    "label": label,
                    "session_id": session_id,
                    "uncompressed_capture_bytes": members[basename].file_size,
                    "window_rows": len(capture_rows),
                })

        write_features(rows, features_csv)

    command = [
        sys.executable,
        str(ROOT / "ml_training" / "train_ble_flood_model.py"),
        "--data", str(features_csv),
        "--model-output", str(model_path),
        "--report-output", str(report_path),
        "--seed", "42",
        "--test-size", "0.25",
        "--minimum-windows-per-class", "10",
        "--minimum-sessions-per-class", "2",
        "--decision-threshold", "0.5",
        "--max-acceptable-fpr", "0.02",
        "--min-acceptable-recall", "0.90",
    ]
    subprocess.run(command, cwd=ROOT, check=True)
    annotate_provenance(report_path, model_path, outer_sha, inner_sha, manifest_details)

    final_report = json.loads(report_path.read_text(encoding="utf-8"))
    print(json.dumps({
        "dataset_download_bytes": outer_bytes,
        "dataset_archive_sha256": outer_sha,
        "feature_rows": len(rows),
        "capture_manifest": manifest_details,
        "metrics": final_report["metrics"],
        "preliminary_gates_passed": final_report["preliminary_gates_passed"],
        "deployment_decision": final_report["deployment_decision"],
        "model_status": "candidate, disabled until explicit review",
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
