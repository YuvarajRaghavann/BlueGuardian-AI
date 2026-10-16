#!/usr/bin/env python3
"""Extract temporal BLE advertising features from Nordic nRF Sniffer PCAPNG using tshark."""
from __future__ import annotations

import argparse
import csv
import math
import shutil
import statistics
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any

WINDOW_COLUMNS = [
    "observation_count",
    "observations_per_second",
    "unique_addresses",
    "unique_address_fraction",
    "max_address_fraction",
    "rssi_mean",
    "rssi_std",
    "rssi_observation_fraction",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pcap", required=True, type=Path)
    parser.add_argument("--label", required=True, choices=["benign", "ble_flood"])
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--window-seconds", type=float, default=5.0)
    return parser.parse_args()


def parse_number(raw: str) -> float | None:
    try:
        value = float(raw.strip())
    except (ValueError, TypeError):
        return None
    return value if math.isfinite(value) else None


def extract_windows(pcap: Path, label: str, session_id: str, window_seconds: float) -> list[dict[str, Any]]:
    tshark = shutil.which("tshark")
    if not tshark:
        raise RuntimeError("tshark is required. Install Wireshark's CLI package (tshark) before extraction.")
    if not pcap.is_file():
        raise FileNotFoundError(f"Capture file not found: {pcap}")
    if window_seconds < 1 or not math.isfinite(window_seconds):
        raise ValueError("--window-seconds must be finite and at least one second.")

    command = [
        tshark, "-n", "-r", str(pcap),
        "-Y", "btle.advertising_address",
        "-T", "fields",
        "-E", "header=y",
        "-E", "separator=/t",
        "-E", "quote=n",
        "-E", "occurrence=f",
        "-e", "frame.time_epoch",
        "-e", "btle.advertising_address",
        "-e", "nordic_ble.rssi",
    ]
    buckets: dict[int, dict[str, Any]] = {}
    first_timestamp: float | None = None
    decoded_count = 0

    with tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as stderr_file:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=stderr_file, text=True, encoding="utf-8", errors="replace")
        assert process.stdout is not None
        reader = csv.reader(process.stdout, delimiter="\t")
        header = next(reader, None)
        if not header or len(header) < 3:
            process.terminate()
            process.wait()
            raise RuntimeError(f"tshark produced no field header for {pcap}; verify Nordic BLE dissector availability.")

        for record in reader:
            if len(record) < 3:
                continue
            timestamp = parse_number(record[0])
            address = record[1].strip().lower().replace("-", ":")
            rssi = parse_number(record[2])
            if timestamp is None or not address:
                continue
            if rssi is not None and not -127 <= rssi <= 20:
                rssi = None

            if first_timestamp is None:
                first_timestamp = timestamp
            window_index = max(0, int((timestamp - first_timestamp) // window_seconds))
            bucket = buckets.setdefault(window_index, {
                "count": 0,
                "addresses": Counter(),
                "rssis": [],
            })
            bucket["count"] += 1
            bucket["addresses"][address] += 1
            if rssi is not None:
                bucket["rssis"].append(rssi)
            decoded_count += 1

        return_code = process.wait()
        stderr_file.seek(0)
        stderr_text = stderr_file.read()[-8000:]

    if return_code != 0:
        raise RuntimeError(f"tshark returned {return_code} for {pcap}: {stderr_text}")
    if not buckets:
        # Include a short raw protocol diagnostic to distinguish unsupported fields
        # from a genuinely empty capture.
        diagnostic = subprocess.run(
            [tshark, "-n", "-r", str(pcap), "-c", "8", "-T", "fields",
             "-E", "separator=/t", "-e", "frame.number", "-e", "_ws.col.Protocol", "-e", "_ws.col.Info"],
            capture_output=True, text=True, timeout=90, check=False,
        )
        raise RuntimeError(
            f"tshark found no frames matching btle.advertising_address in {pcap}. "
            f"Sample protocol rows={diagnostic.stdout[:3000]!r}; errors={diagnostic.stderr[-3000:]!r}. "
            "Do not train on an empty feature set."
        )

    result: list[dict[str, Any]] = []
    for index in sorted(buckets):
        bucket = buckets[index]
        count = int(bucket["count"])
        addresses: Counter[str] = bucket["addresses"]
        addressed_count = sum(addresses.values())
        rssis: list[float] = bucket["rssis"]
        result.append({
            "capture_path": pcap.name,
            "session_id": session_id,
            "label": label,
            "window_index": index,
            "window_start_seconds": round(index * window_seconds, 6),
            "window_seconds": float(window_seconds),
            "observation_count": count,
            "observations_per_second": count / window_seconds,
            "unique_addresses": len(addresses),
            "unique_address_fraction": len(addresses) / addressed_count if addressed_count else 0.0,
            "max_address_fraction": max(addresses.values()) / addressed_count if addressed_count else 0.0,
            "rssi_mean": statistics.fmean(rssis) if rssis else "",
            "rssi_std": statistics.pstdev(rssis) if len(rssis) > 1 else (0.0 if rssis else ""),
            "rssi_observation_fraction": len(rssis) / count if count else 0.0,
            "address_coverage": 1.0,
        })

    print(
        f"{pcap.name}: advertising_frames={decoded_count}, windows={len(result)}, "
        f"label={label}, session={session_id}",
        file=sys.stderr,
    )
    return result


def main() -> int:
    args = parse_args()
    rows = extract_windows(args.pcap, args.label, args.session_id, args.window_seconds)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "capture_path", "session_id", "label", "window_index", "window_start_seconds",
        "window_seconds", *WINDOW_COLUMNS, "address_coverage",
    ]
    with args.output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} window rows to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
