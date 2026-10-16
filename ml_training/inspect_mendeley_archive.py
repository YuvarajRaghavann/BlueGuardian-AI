#!/usr/bin/env python3
"""Download and inventory the public BLE dataset archive without extracting packet captures."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

DOWNLOAD_URL = "https://data.mendeley.com/public-api/zip/ntmmcw6jj8/download/2"
MAX_DOWNLOAD_BYTES = 1_000_000_000
MAX_DOC_BYTES = 1_500_000
OUT = Path("ml_training/reports/mendeley_archive_inventory.json")
DOC_NAMES = {"readme", "read_me", "dataset_description", "metadata", "manifest", "labels", "label_map"}


def stream_download(destination: Path) -> tuple[int, str, str | None]:
    request = urllib.request.Request(
        DOWNLOAD_URL,
        headers={
            "User-Agent": "BlueGuardian-BLE-Research-Training/1.0",
            "Accept": "application/zip,application/octet-stream,*/*",
        },
    )
    digest = hashlib.sha256()
    byte_count = 0
    with urllib.request.urlopen(request, timeout=180) as response:
        # Do not log final_url because the redirect may be a time-limited signed URL.
        content_type = response.headers.get("Content-Type", "unknown")
        expected = response.headers.get("Content-Length")
        expected_length = int(expected) if expected and expected.isdigit() else None
        if expected_length is not None and expected_length > MAX_DOWNLOAD_BYTES:
            raise RuntimeError(f"Archive length exceeds {MAX_DOWNLOAD_BYTES} bytes.")
        with destination.open("wb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                byte_count += len(chunk)
                if byte_count > MAX_DOWNLOAD_BYTES:
                    raise RuntimeError(f"Archive exceeded {MAX_DOWNLOAD_BYTES} bytes; download aborted.")
                output.write(chunk)
                digest.update(chunk)
    return byte_count, digest.hexdigest(), content_type


def read_metadata_doc(archive: zipfile.ZipFile, member: zipfile.ZipInfo) -> str | None:
    path = PurePosixPath(member.filename)
    stem = path.stem.lower().replace("-", "_").replace(" ", "_")
    if member.file_size > MAX_DOC_BYTES:
        return None
    if path.suffix.lower() not in {".md", ".txt", ".json", ".yml", ".yaml", ".csv"}:
        return None
    looks_like_metadata = (
        stem in DOC_NAMES
        or "readme" in stem
        or "label" in stem
        or "manifest" in stem
        or "metadata" in stem
        or "description" in stem
    )
    if not looks_like_metadata:
        return None
    raw = archive.read(member)
    return raw[:80_000].decode("utf-8", errors="replace")


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="blueguardian-ble-data-") as tmp:
        archive_path = Path(tmp) / "BLE_Datasets.zip"
        byte_count, sha256, content_type = stream_download(archive_path)
        if not zipfile.is_zipfile(archive_path):
            raise RuntimeError(f"Public route did not return a ZIP archive (content-type {content_type}).")

        files = []
        docs = []
        counts_by_extension: dict[str, int] = {}
        sizes_by_extension: dict[str, int] = {}
        total_uncompressed = 0
        with zipfile.ZipFile(archive_path) as archive:
            for member in archive.infolist():
                if member.is_dir():
                    continue
                path = PurePosixPath(member.filename)
                extension = path.suffix.lower() or "[no extension]"
                counts_by_extension[extension] = counts_by_extension.get(extension, 0) + 1
                sizes_by_extension[extension] = sizes_by_extension.get(extension, 0) + member.file_size
                total_uncompressed += member.file_size
                files.append({
                    "path": member.filename,
                    "extension": extension,
                    "compressed_bytes": member.compress_size,
                    "uncompressed_bytes": member.file_size,
                    "file_size_limit_for_extract": member.file_size <= MAX_DOC_BYTES,
                    "likely_capture": extension in {".pcap", ".pcapng", ".btsnoop", ".cap"},
                })
                doc = read_metadata_doc(archive, member)
                if doc is not None:
                    docs.append({"path": member.filename, "text": doc})

        report = {
            "source": "https://data.mendeley.com/datasets/ntmmcw6jj8/2",
            "doi": "10.17632/ntmmcw6jj8.2",
            "licence": "CC BY 4.0",
            "archive_name_on_landing_page": "BLE_Datasets.zip",
            "public_download_route": DOWNLOAD_URL,
            "archive_download_bytes": byte_count,
            "archive_sha256": sha256,
            "archive_content_type": content_type,
            "total_uncompressed_bytes": total_uncompressed,
            "file_count": len(files),
            "counts_by_extension": counts_by_extension,
            "uncompressed_bytes_by_extension": sizes_by_extension,
            "files": files,
            "small_metadata_documents": docs,
            "security_note": (
                "Raw data was downloaded only to a temporary GitHub runner directory. "
                "Packet captures were inventoried but not extracted or committed to Git."
            ),
        }
        OUT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({
            "download_bytes": byte_count,
            "sha256": sha256,
            "file_count": len(files),
            "counts_by_extension": counts_by_extension,
            "metadata_document_paths": [doc["path"] for doc in docs],
            "report_path": str(OUT),
        }, indent=2))


if __name__ == "__main__":
    main()
