#!/usr/bin/env python3
"""Inventory BLEGuard spreadsheet samples without committing raw captures."""
from __future__ import annotations

import json
import re
import urllib.request
from pathlib import Path
from openpyxl import load_workbook

FILES = [
    "dataset/BLE-SAD/10.3.xlsx",
    "dataset/BLE-SAD/10.4.xlsx",
    "dataset/BLE-SAD/10.5.xlsx",
    "dataset/BLE-SAD/10.6.xlsx",
    "dataset/BLE-SAD/10.7.xlsx",
    "dataset/BLE-SAD/10.8.xlsx",
    "dataset/BLE-SAD/10.9.xlsx",
    "dataset/BLE-SAD/10.10.xlsx",
    "dataset/BLE-SAD/12.10.xlsx",
    "dataset/BLE-SAD/12.12.xlsx",
    "dataset/BLE-SAD/12.15.xlsx",
    "dataset/BLE-SAD/12.18.xlsx",
]
BASE = "https://raw.githubusercontent.com/BLEGuard/supplement/master/"
MAC = re.compile(r"(?i)(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|^[0-9a-f]{12}$")
OUT = Path("ml_training/reports/bleguard_sample_inventory.json")


def safe_value(value):
    if value is None:
        return None
    text = str(value)
    if MAC.fullmatch(text.strip()):
        return "[REDACTED_MAC]"
    if len(text) > 120:
        return text[:117] + "..."
    return text


def inspect(url_path):
    request = urllib.request.Request(
        BASE + url_path,
        headers={"User-Agent": "BlueGuardian-BLE-Sample-Inventory/1.0"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        data = response.read(30 * 1024 * 1024 + 1)
    if len(data) > 30 * 1024 * 1024:
        raise ValueError(f"File exceeds 30 MiB inventory limit: {url_path}")

    from io import BytesIO
    wb = load_workbook(BytesIO(data), read_only=True, data_only=True)
    sheets = []
    for ws in wb.worksheets:
        rows = ws.iter_rows(values_only=True)
        first_rows = []
        first_nonempty = None
        nonempty_row_count = 0
        for row in rows:
            cells = [safe_value(value) for value in row]
            if any(value is not None and value != "" for value in row):
                nonempty_row_count += 1
                if first_nonempty is None:
                    first_nonempty = cells
                if len(first_rows) < 4:
                    first_rows.append(cells)
        sheets.append({
            "sheet": ws.title,
            "reported_max_row": ws.max_row,
            "reported_max_column": ws.max_column,
            "nonempty_rows": nonempty_row_count,
            "first_nonempty_row": first_nonempty,
            "sample_rows_redacted": first_rows,
        })
    wb.close()
    return {"path": url_path, "download_bytes": len(data), "sheets": sheets}


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    inventory = []
    failures = []
    for path in FILES:
        try:
            record = inspect(path)
            inventory.append(record)
            print(f"OK {path}: " + ", ".join(
                f"{s['sheet']} rows={s['nonempty_rows']} cols={s['reported_max_column']}"
                for s in record["sheets"]
            ))
        except Exception as exc:
            failures.append({"path": path, "error": f"{type(exc).__name__}: {exc}"})
            print(f"FAILED {path}: {type(exc).__name__}: {exc}")
    report = {
        "source": "https://github.com/BLEGuard/supplement/tree/master/dataset/BLE-SAD",
        "warning": (
            "This is a structural inventory only. Do not train until the dataset documentation "
            "establishes labels, units, observation semantics, and independent capture sessions."
        ),
        "files": inventory,
        "failures": failures,
    }
    OUT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if not inventory:
        raise SystemExit("No sample workbook could be inspected.")
    print(f"Wrote inventory: {OUT}")


if __name__ == "__main__":
    main()
