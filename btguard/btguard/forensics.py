"""Tamper-evident forensic log: every entry commits to the hash of the previous one."""
from __future__ import annotations
import hashlib, json


class ForensicLog:
    def __init__(self, path=None):
        self.entries, self.path = [], path

    def add(self, t, event, device, data=None):
        prev = self.entries[-1]["hash"] if self.entries else "0" * 64
        e = {"seq": len(self.entries), "t": t, "event": event, "device": device, "data": data or {}, "prev": prev}
        e["hash"] = hashlib.sha256(json.dumps(e, sort_keys=True, default=str).encode()).hexdigest()
        self.entries.append(e)
        if self.path:
            with open(self.path, "a") as f:
                f.write(json.dumps(e, default=str) + "\n")
        return e

    @staticmethod
    def verify_entries(entries):
        prev = "0" * 64
        for e in entries:
            body = {k: v for k, v in e.items() if k != "hash"}
            if body["prev"] != prev:
                return False
            if hashlib.sha256(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest() != e["hash"]:
                return False
            prev = e["hash"]
        return True

    def verify(self):
        return self.verify_entries(self.entries)
