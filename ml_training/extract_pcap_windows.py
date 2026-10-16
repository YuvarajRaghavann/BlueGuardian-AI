#!/usr/bin/env python3
"""Create labeled BLE observation-window features from a manifest of PCAP files.

Ground truth comes only from the manifest. The script never derives attack labels
from packet contents or filenames.
"""
from __future__ import annotations

import argparse
import csv
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean, pstdev
from typing import Any

try:
    from scapy.utils import PcapReader
except ImportError as exc:  # pragma: no cover - exercised in the CLI environment
    raise SystemExit(
        "Scapy is required. Install the declared dependencies with "
        "'python -m pip install -r ml_training/requirements.txt'."
    ) from exc

LABELS = {"benign", "ble_flood"}
FEATURE_COLUMNS = [
    "observation_count",
    "observations_per_second",
    "unique_addresses",
    "unique_address_fraction",
    "max_address_fraction",
    "rssi_mean",
    "rssi_std",
    "rssi_observation_fraction",
]
ADDRESS_FIELDS = {"adva", "inita", "targeta", "bdaddr", "address", "addr"}
RSSI_FIELDS = {"rssi", "dbmantsignal", "receivedsignalstrength"}
MAC_PATTERN = re.compile(r"(?i)(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|^[0-9a-f]{12}$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path, help="CSV: pcap_path,label,session_id")
    parser.add_argument("--output", required=True, type=Path, help="Output window-level CSV")
    parser.add_argument("--window-seconds", type=float, default=5.0)
    parser.add_argument("--max-packets-per-capture", type=int, default=0,
                        help="Optional guardrail; 0 means no limit")
    return parser.parse_args()


def normalise_address(value: Any) -> str | None:
    if value is None:
        return None
    candidate = str(value).strip().lower().replace("-", ":")
    if not MAC_PATTERN.fullmatch(candidate):
        return None
    if ":" not in candidate and len(candidate) == 12:
        candidate = ":".join(candidate[i:i + 2] for i in range(0, 12, 2))
    return candidate


def packet_layers(packet: Any) -> list[Any]:
    try:
        return list(packet.layers())
    except Exception:
        return []


def is_ble_advertisement(packet: Any, layers: list[Any]) -> bool:
    # Scapy may decode an advertising packet to BTLE_ADV_IND, BTLE_SCAN_RSP,
    # or related classes, so match the advertising family rather than one subtype.
    names = [type(layer).__name__.upper() for layer in layers]
    if any(name.startswith("BTLE_ADV") or name == "BTLE_SCAN_RSP" for name in names):
        return True
    # The broader check helps with captures where dissection exposes a generic
    # BTLE packet plus the advertising PDU type field.
    if any("BTLE" in name for name in names):
        for layer in layers:
            for field, value in getattr(layer, "fields", {}).items():
                if field.lower() in {"pdu_type", "ptype"}:
                    try:
                        # Advertising PDU types are represented by Scapy enum fields.
                        rendered = str(value).upper()
                        if "ADV" in rendered or "SCAN_RSP" in rendered:
                            return True
                    except Exception:
                        pass
    return False


def extract_address(layers: list[Any]) -> str | None:
    # Prefer advertiser/source fields only inside Bluetooth-related layers.
    for layer in layers:
        if "BTLE" not in type(layer).__name__.upper():
            continue
        for field, value in getattr(layer, "fields", {}).items():
            if field.lower() in ADDRESS_FIELDS:
                address = normalise_address(value)
                if address:
                    return address
    return None


def extract_rssi(layers: list[Any]) -> float | None:
    for layer in layers:
        layer_name = type(layer).__name__.upper()
        for field, value in getattr(layer, "fields", {}).items():
            field_name = field.lower()
            if field_name not in RSSI_FIELDS and not (
                field_name == "signal" and ("RF" in layer_name or "RADIOTAP" in layer_name)
            ):
                continue
            try:
                number = float(value)
            except (TypeError, ValueError):
                continue
            # Exclude impossible and obvious metadata values.
            if math.isfinite(number) and -127 <= number <= 20:
                return number
    return None


def extract_capture(path: Path, label: str, session_id: str, window_seconds: float,
                    max_packets: int = 0) -> list[dict[str, Any]]:
    if label not in LABELS:
        raise ValueError(f"{path}: unsupported label {label!r}; use one of {sorted(LABELS)}")
    if not path.is_file():
        raise FileNotFoundError(f"Capture does not exist: {path}")

    # Each bucket is tied to one original capture/session, which is kept intact
    # during train/test splitting to prevent adjacent-window leakage.
    buckets: dict[int, dict[str, Any]] = defaultdict(
        lambda: {"count": 0, "addresses": Counter(), "rssis": [], "addressed_count": 0}
    )
    start_ts: float | None = None
    ble_count = 0
    missing_address_count = 0
    seen_packets = 0

    with PcapReader(str(path)) as reader:
        for packet in reader:
            seen_packets += 1
            if max_packets and seen_packets > max_packets:
                raise RuntimeError(
                    f"{path}: capture exceeded --max-packets-per-capture={max_packets}; "
                    "use a larger explicit limit rather than silently truncating."
                )
            layers = packet_layers(packet)
            if not is_ble_advertisement(packet, layers):
                continue
            try:
                timestamp = float(packet.time)
            except (TypeError, ValueError):
                continue
            if not math.isfinite(timestamp):
                continue

            if start_ts is None:
                start_ts = timestamp
            window_index = max(0, int((timestamp - start_ts) // window_seconds))
            bucket = buckets[window_index]
            bucket["count"] += 1
            ble_count += 1

            address = extract_address(layers)
            if address is None:
                missing_address_count += 1
            else:
                bucket["addresses"][address] += 1
                bucket["addressed_count"] += 1

            rssi = extract_rssi(layers)
            if rssi is not None:
                bucket["rssis"].append(rssi)

    if not buckets:
        raise ValueError(
            f"No BLE advertising packets were decoded from {path}. Check the capture link type "
            "and Scapy's Bluetooth dissection before training."
        )
    if ble_count == 0:
        raise ValueError(f"No BLE advertising packets found in {path}")

    result: list[dict[str, Any]] = []
    for index in sorted(buckets):
        bucket = buckets[index]
        count = int(bucket["count"])
        addresses: Counter[str] = bucket["addresses"]
        addressed_count = int(bucket["addressed_count"])
        rssis: list[float] = bucket["rssis"]
        unique_addresses = len(addresses)
        result.append({
            "capture_path": str(path),
            "session_id": session_id,
            "label": label,
            "window_index": index,
            "window_start_seconds": round(index * window_seconds, 6),
            "window_seconds": float(window_seconds),
            "observation_count": count,
            "observations_per_second": count / window_seconds,
            "unique_addresses": unique_addresses,
            "unique_address_fraction": unique_addresses / addressed_count if addressed_count else 0.0,
            "max_address_fraction": max(addresses.values()) / addressed_count if addressed_count else 0.0,
            "rssi_mean": mean(rssis) if rssis else "",
            "rssi_std": pstdev(rssis) if len(rssis) > 1 else (0.0 if rssis else ""),
            "rssi_observation_fraction": len(rssis) / count if count else 0.0,
            "address_coverage": addressed_count / count if count else 0.0,
        })

    print(
        f"{path}: decoded_windows={len(result)}, advertisement_observations={ble_count}, "
        f"address_coverage={(1 - missing_address_count / ble_count):.3f}",
        file=sys.stderr,
    )
    if missing_address_count / ble_count > 0.1:
        print(
            f"WARNING: {path} is missing advertiser addresses on more than 10% of decoded "
            "advertisements; inspect capture format before accepting this feature set.",
            file=sys.stderr,
        )
    return result


def main() -> int:
    args = parse_args()
    if not math.isfinite(args.window_seconds) or args.window_seconds < 1.0:
        raise SystemExit("--window-seconds must be at least 1.0")
    if args.max_packets_per_capture < 0:
        raise SystemExit("--max-packets-per-capture cannot be negative")
    if not args.manifest.is_file():
        raise SystemExit(f"Manifest not found: {args.manifest}")

    manifest_base = args.manifest.resolve().parent
    rows: list[dict[str, Any]] = []
    with args.manifest.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        required = {"pcap_path", "label", "session_id"}
        if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
            raise SystemExit(f"Manifest must contain columns: {', '.join(sorted(required))}")
        capture_rows = list(reader)

    if not capture_rows:
        raise SystemExit("Manifest has no captures.")
    capture_sessions: set[tuple[str, str]] = set()
    for capture in capture_rows:
        raw_path = Path((capture.get("pcap_path") or "").strip())
        if not str(raw_path):
            raise SystemExit("Manifest contains an empty pcap_path.")
        path = raw_path if raw_path.is_absolute() else manifest_base / raw_path
        label = (capture.get("label") or "").strip().lower()
        session_id = (capture.get("session_id") or "").strip()
        if not session_id:
            raise SystemExit(f"Manifest row for {path} has an empty session_id.")
        if label not in LABELS:
            raise SystemExit(f"Manifest row for {path} has unsupported label {label!r}.")
        key = (str(path.resolve()), session_id)
        if key in capture_sessions:
            raise SystemExit(f"Duplicate capture/session mapping in manifest: {key}")
        capture_sessions.add(key)
        rows.extend(extract_capture(path, label, session_id, args.window_seconds, args.max_packets_per_capture))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "capture_path", "session_id", "label", "window_index", "window_start_seconds",
        "window_seconds", *FEATURE_COLUMNS, "address_coverage",
    ]
    with args.output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} window rows to {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
