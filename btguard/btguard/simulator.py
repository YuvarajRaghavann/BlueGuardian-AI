"""Synthetic BLE traffic: normal behaviour plus five attack types.

ASSUMPTIONS (this is a simulator, not a radio): log-distance path loss with
exponent 2 and -45 dBm at 1 m, ~2.5 dB shadowing noise, per-device oscillator
offset (CFO) of +-25 kHz with ~1 kHz jitter, CS distance error ~15 cm.
Replace this with real captures (see README) before trusting any number.
"""
from __future__ import annotations
import math, os, random
from .models import Observation

REF_RSSI = -45.0
PATH_LOSS_N = 2.0
ATTACKS = ["clone_spoof", "relay", "downgrade", "dos_flood", "pair_bruteforce"]
# attacks that leave a signature in link *behaviour* (what the ML layer can see)
BEHAVIORAL = ["dos_flood", "pair_bruteforce", "relay"]


def rssi_at(d: float, rng: random.Random, sigma: float = 2.5) -> float:
    return REF_RSSI - 10 * PATH_LOSS_N * math.log10(max(d, 0.1)) + rng.gauss(0, sigma)


class DeviceProfile:
    def __init__(self, device_id: str, rng: random.Random):
        self.device_id = device_id
        self.cfo_mu = rng.uniform(-25, 25)
        self.cfo_sd = rng.uniform(0.8, 1.6)
        self.distance = rng.uniform(1.0, 6.0)
        self.base_rate = rng.uniform(8, 20)
        self.interval = rng.choice([30.0, 45.0, 50.0, 75.0])


def observe(p: DeviceProfile, kind: str, t: float, rng: random.Random) -> Observation:
    d = p.distance
    o = dict(
        device_id=p.device_id, t=t,
        secure_connections=True, encrypted=True, authenticated=True, key_size=16,
        rssi_dbm=rssi_at(d, rng), cfo_khz=rng.gauss(p.cfo_mu, p.cfo_sd),
        cs_distance_m=max(0.05, d + rng.gauss(0, 0.15)),
        conn_interval_ms=p.interval + rng.gauss(0, 0.3),
        pkt_rate=max(0.0, rng.gauss(p.base_rate, 1.5)),
        pair_attempts=1 if rng.random() < 0.02 else 0,
        error_rate=abs(rng.gauss(0.01, 0.01)),
        iat_jitter_ms=abs(rng.gauss(2.0, 0.8)),
        label=kind,
    )
    # benign hiccups so the false-positive numbers mean something
    if rng.random() < 0.03:
        o["rssi_dbm"] -= rng.uniform(5, 9)          # body shadowing / fade
    if rng.random() < 0.03:
        o["error_rate"] = rng.uniform(0.03, 0.08)   # short interference burst

    if kind == "clone_spoof":       # valid keys, different radio, different place
        d2 = rng.uniform(3, 10)
        o["cfo_khz"] = rng.gauss(p.cfo_mu + rng.choice([-1, 1]) * rng.uniform(8, 15), 1.2)
        o["rssi_dbm"] = rssi_at(d2, rng)
        o["cs_distance_m"] = d2 + rng.gauss(0, 0.15)
    elif kind == "relay":           # real device is far, CS distance is forged short
        o["rssi_dbm"] = rssi_at(d + rng.uniform(8, 20), rng)
        o["iat_jitter_ms"] += rng.uniform(4, 10)    # relay hop adds latency jitter
    elif kind == "downgrade":
        o["secure_connections"] = False
        o["authenticated"] = False
        o["key_size"] = rng.randint(1, 7)
    elif kind == "dos_flood":
        o["pkt_rate"] = max(0.0, rng.gauss(p.base_rate * 12, 20))
        o["error_rate"] = rng.uniform(0.1, 0.35)
        o["pair_attempts"] = rng.randint(0, 3)
        o["iat_jitter_ms"] += rng.uniform(3, 8)
    elif kind == "pair_bruteforce":
        o["pair_attempts"] = rng.randint(4, 12)
        o["error_rate"] = rng.uniform(0.04, 0.12)
    return Observation(**o)


def stream(p, rng, schedule, total):
    """schedule: list of (start, end, kind). Yields one Observation per second."""
    for t in range(total):
        kind = "normal"
        for a, b, k in schedule:
            if a <= t < b:
                kind = k
        yield observe(p, kind, float(t), rng)


def enrollment_samples(p, rng, n=20):
    return [observe(p, "normal", float(-n + i), rng) for i in range(n)]
