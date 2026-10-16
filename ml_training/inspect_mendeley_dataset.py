#!/usr/bin/env python3
"""Download a public Mendeley dataset ZIP to a temporary file and list its members.

This utility inventories capture names only. It does not extract data, infer labels,
or add research data to the Git repository.
"""
from __future__ import annotations

import argparse
import tempfile
import urllib.request
import zipfile
from pathlib import Path

DEFAULT_URL = "https://api.data.mendeley.com/datasets/ntmmcw6jj8/zip/file_downloaded?version=2"
MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--max-download-bytes", type=int, default=MAX_DOWNLOAD_BYTES)
    args = parser.parse_args()
    if args.max_download_bytes < 1:
        raise SystemExit("--max-download-bytes must be positive")

    request = urllib.request.Request(
        args.url,
        headers={"User-Agent": "BlueGuardian-ML-dataset-inventory/1.0", "Accept": "application/zip,*/*"},
    )
    with tempfile.TemporaryDirectory(prefix="blueguardian-ble-dataset-") as temp_dir:
        archive_path = Path(temp_dir) / "dataset.zip"
        with urllib.request.urlopen(request, timeout=90) as response:
            content_type = response.headers.get("Content-Type", "unknown")
            length_header = response.headers.get("Content-Length")
            expected_length = int(length_header) if length_header and length_header.isdigit() else None
            if expected_length is not None and expected_length > args.max_download_bytes:
                raise SystemExit(
                    f"Dataset archive reports {expected_length} bytes, above the configured "
                    f"{args.max_download_bytes}-byte limit. Do not increase the limit without reviewing storage."
                )
            bytes_written = 0
            with archive_path.open("wb") as output:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    bytes_written += len(chunk)
                    if bytes_written > args.max_download_bytes:
                        raise SystemExit(
                            f"Dataset download exceeded {args.max_download_bytes} bytes; "
                            "download stopped before extraction."
                        )
                    output.write(chunk)

        if not zipfile.is_zipfile(archive_path):
            raise SystemExit(
                "Mendeley did not return a ZIP archive. Check the HTTP response and current public-download endpoint."
            )

        with zipfile.ZipFile(archive_path) as archive:
            members = [info for info in archive.infolist() if not info.is_dir()]
            lines = [
                "# Mendeley BLE Raw-Capture Dataset Inventory",
                "",
                "Source: https://data.mendeley.com/datasets/ntmmcw6jj8/2",
                "DOI: 10.17632/ntmmcw6jj8.2",
                "Licence: CC BY 4.0 (attribute the dataset in derivative research outputs).",
                "",
                "This report lists archive paths and sizes only; capture data was not extracted or committed.",
                "",
                f"- Response content type: {content_type}",
                f"- Downloaded ZIP bytes: {bytes_written}",
                f"- Archive member count: {len(members)}",
                "",
                "| Archive path | Uncompressed bytes | Compressed bytes |",
                "|---|---:|---:|",
            ]
            for info in sorted(members, key=lambda item: item.filename.lower()):
                safe_name = info.filename.replace("|", "\\|")
                lines.append(f"| `{safe_name}` | {info.file_size} | {info.compress_size} |")

            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"Inventory written to {args.output}; no files were extracted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
