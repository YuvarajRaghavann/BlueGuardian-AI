#!/usr/bin/env python3
"""Inspect the public Mendeley dataset page for its downloadable-file metadata.

This read-only helper discovers whether a public file URL is available; it never
downloads the 478 MB archive and never prints cookies or authorization headers.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

PAGE = "https://data.mendeley.com/datasets/ntmmcw6jj8/2"
API_URLS = [
    "https://api.data.mendeley.com/datasets/ntmmcw6jj8/files?version=2",
    "https://api.data.mendeley.com/datasets/ntmmcw6jj8/zip/file_downloaded?version=2",
    "https://api.data.mendeley.com/datasets/ntmmcw6jj8?version=2",
]
OUT = Path("ml_training/reports/mendeley_access_diagnostics.json")
TERMS = re.compile(
    r"BLE_Datasets\.zip|file_downloaded|public-files|fileId|file_id|download.?all|"
    r"datasets/ntmmcw6jj8/files|api\.data\.mendeley\.com",
    re.IGNORECASE,
)


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.meta = []
        self.script_srcs = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a" and attrs.get("href"):
            self.links.append({"href": attrs["href"], "text": ""})
            self._last_link = len(self.links) - 1
        if tag == "meta":
            self.meta.append({
                "name": attrs.get("name") or attrs.get("property"),
                "content": attrs.get("content"),
            })
        if tag == "script" and attrs.get("src"):
            self.script_srcs.append(attrs["src"])

    def handle_data(self, data):
        # A text fragment follows an <a> in common HTML. Keep short labels only.
        if getattr(self, "_last_link", None) is not None:
            record = self.links[self._last_link]
            if len(record["text"]) < 160:
                record["text"] = (record["text"] + " " + data).strip()[:160]


def get(url, limit=8 * 1024 * 1024):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 BlueGuardian-Dataset-Access-Diagnostic/1.0",
            "Accept": "text/html,application/json,*/*",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read(limit + 1)
            if len(body) > limit:
                body = body[:limit]
            return {
                "requested_url": url,
                "status": resp.status,
                "final_url": resp.geturl(),
                "content_type": resp.headers.get("Content-Type"),
                "body": body,
            }
    except urllib.error.HTTPError as exc:
        return {
            "requested_url": url,
            "status": exc.code,
            "final_url": exc.geturl(),
            "content_type": exc.headers.get("Content-Type"),
            "body": exc.read(3000),
        }
    except Exception as exc:
        return {"requested_url": url, "error": f"{type(exc).__name__}: {exc}"}


def main():
    page_result = get(PAGE)
    report = {
        "source": PAGE,
        "dataset": "Bluetooth Low Energy (BLE) Dataset: Raw-Capture for Intrusion Analysis",
        "doi": "10.17632/ntmmcw6jj8.2",
        "declared_archive": "BLE_Datasets.zip (478 MB, according to the public landing page)",
        "page": {},
        "api_probes": [],
        "access_decision": "not_yet_determined",
    }

    if "body" in page_result:
        text = page_result["body"].decode("utf-8", errors="replace")
        parser = PageParser()
        parser.feed(text)
        snippets = []
        for match in TERMS.finditer(text):
            left = max(0, match.start() - 220)
            right = min(len(text), match.end() + 420)
            snippet = re.sub(r"\s+", " ", text[left:right])
            if snippet not in snippets:
                snippets.append(snippet)
        report["page"] = {
            "status": page_result.get("status"),
            "final_url": page_result.get("final_url"),
            "content_type": page_result.get("content_type"),
            "bytes_read": len(page_result["body"]),
            "links": parser.links[:150],
            "meta": [m for m in parser.meta if m.get("name") and m.get("content")][:80],
            "script_srcs": parser.script_srcs[:100],
            "matching_source_snippets": snippets[:80],
        }
    else:
        report["page"] = page_result

    for url in API_URLS:
        item = get(url, limit=100_000)
        item.pop("body", None)
        report["api_probes"].append(item)

    # The HTML loads the file tree client-side. Inspect only its public JS assets
    # to find the documented route used by the landing-page Download All button.
    report["client_script_probes"] = []
    candidate_scripts = []
    if isinstance(report.get("page"), dict):
        for src in report["page"].get("script_srcs", []):
            if "/datasets/bundle.js" in src or "script-v2.0.5.min.js" in src:
                if src.startswith("//"):
                    src = "https:" + src
                elif src.startswith("/"):
                    src = "https://data.mendeley.com" + src
                candidate_scripts.append(src)
    for url in candidate_scripts[:6]:
        item = get(url, limit=6 * 1024 * 1024)
        body = item.pop("body", b"")
        source = body.decode("utf-8", errors="replace")
        needles = [
            "download-all", "file_downloaded", "public-files", "datasets/",
            "authorization", "access_token", "files?version", "zip/file_downloaded",
        ]
        snippets = []
        for needle in needles:
            start = 0
            while len(snippets) < 40:
                index = source.lower().find(needle.lower(), start)
                if index < 0:
                    break
                snippets.append({
                    "term": needle,
                    "snippet": re.sub(r"\\s+", " ", source[max(0, index-140):min(len(source), index+260)]),
                })
                start = index + len(needle)
        item["matching_source_snippets"] = snippets[:40]
        report["client_script_probes"].append(item)

    api_statuses = [item.get("status") for item in report["api_probes"]]
    if any(status == 200 for status in api_statuses):
        report["access_decision"] = "at_least_one_api_endpoint_is_public"
    elif 401 in api_statuses or 403 in api_statuses:
        report["access_decision"] = "file_api_requires_authentication_or_authorization"
    else:
        report["access_decision"] = "no_public_file_endpoint_found_from_basic_api_probes"

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "page_status": report["page"].get("status") if isinstance(report["page"], dict) else None,
        "access_decision": report["access_decision"],
        "api_probes": report["api_probes"],
        "report_path": str(OUT),
        "candidate_links": report["page"].get("links", [])[:20] if isinstance(report["page"], dict) else [],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
