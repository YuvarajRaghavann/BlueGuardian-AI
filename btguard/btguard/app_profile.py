"""BTGuard behaviour model for the BlueGuardian Secure Link (Android app).

The original simulator (simulator.py) models controller-level telemetry (CFO,
Channel Sounding) that a phone app cannot read. The app's secure channel can
measure four things per 1-second window, so the shipped model uses those:

  log_pkt_rate   frames received per second (log1p)
  pair_attempts  extra connection / handshake attempts while a session is live
  error_rate     share of frames that failed authentication (tampered/replayed/injected)
  rtt_jitter_ms  standard deviation of encrypted ping round-trip times

ASSUMPTIONS: the distributions below are design assumptions for a BLE L2CAP
channel, not measurements. Replace them with real two-phone captures
(`python -m btguard replay-app capture.jsonl`) before claiming any accuracy.

Export the model for the app with:
    python -m btguard export-app-model --out ../src/secure/trustModel.json
"""
from __future__ import annotations
import json, math, random
from datetime import datetime, timezone
import numpy as np
from .ml import TrustModel, metrics

APP_FEATURES = ["log_pkt_rate", "pair_attempts", "error_rate", "rtt_jitter_ms"]
APP_SD_FLOOR = np.array([0.15, 1.0, 0.01, 5.0])
APP_ATTACKS = ["frame_flood", "injection_replay", "handshake_bruteforce", "relay"]


def app_window(kind: str, rng: random.Random) -> dict:
    """One simulated 1-second window of secure-session telemetry."""
    transferring = rng.random() < 0.4
    w = {
        "pkt_rate": rng.uniform(15, 90) if transferring else max(0.0, rng.gauss(2.0, 0.7)),
        "pair_attempts": 1 if rng.random() < 0.03 else 0,
        "error_rate": rng.uniform(0.005, 0.03) if rng.random() < 0.005 else 0.0,
        "rtt_jitter_ms": abs(rng.gauss(20 if transferring else 8, 10 if transferring else 5)),
        "label": kind,
    }
    if kind == "frame_flood":
        w["pkt_rate"] = rng.uniform(250, 1500)
        w["error_rate"] = rng.uniform(0.3, 0.95)
        w["rtt_jitter_ms"] += rng.uniform(20, 80)
    elif kind == "injection_replay":
        w["error_rate"] = rng.uniform(0.05, 0.5)
    elif kind == "handshake_bruteforce":
        w["pair_attempts"] = rng.randint(3, 15)
    elif kind == "relay":
        w["rtt_jitter_ms"] += rng.uniform(60, 250)
    return w


def app_featurize(w: dict) -> np.ndarray:
    return np.array([math.log1p(w["pkt_rate"]), float(w["pair_attempts"]), w["error_rate"], w["rtt_jitter_ms"]])


def app_dataset(kinds, n, rng):
    X, y = [], []
    for k in kinds:
        for _ in range(n):
            X.append(app_featurize(app_window(k, rng)))
            y.append(0 if k == "normal" else 1)
    return np.array(X), np.array(y)


def train_app_model(seed: int = 3) -> TrustModel:
    rng = random.Random(seed)
    Xn, _ = app_dataset(["normal"], 4000, rng)
    m = TrustModel()
    m.mu = Xn.mean(0)
    m.sd = np.maximum(Xn.std(0), APP_SD_FLOOR)
    X, y = app_dataset(["normal"] * 4 + APP_ATTACKS, 800, rng)
    return m.train(X, y, epochs=2000, lr=0.1)


def evaluate_app_model(m: TrustModel, seed: int = 99) -> dict:
    rng = random.Random(seed)
    out = {}
    Xn, yn = app_dataset(["normal"], 3000, rng)
    out["normal_false_positive_rate"] = float((m.proba(Xn) >= 0.5).mean())
    for k in APP_ATTACKS:
        Xa, _ = app_dataset([k], 500, rng)
        out[f"{k}_window_recall"] = float((m.proba(Xa) >= 0.5).mean())
    X, y = app_dataset(["normal"] * 4 + APP_ATTACKS, 500, rng)
    out.update({f"overall_{k}": float(v) for k, v in metrics(y, m.proba(X)).items()})
    return out


def export_app_model(path: str, seed: int = 3) -> dict:
    m = train_app_model(seed)
    ev = evaluate_app_model(m)
    doc = {
        "schema": "btguard-app-model/1",
        "kind": "logistic-regression",
        "features": APP_FEATURES,
        "mu": [round(float(v), 6) for v in m.mu],
        "sd": [round(float(v), 6) for v in m.sd],
        "w": [round(float(v), 6) for v in m.w],
        "b": round(float(m.b), 6),
        "trainedOn": "BTGuard app-session simulator (design assumptions, not field captures)",
        "simulatorEvaluation": {k: round(v, 4) for k, v in ev.items()},
        "exportedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    with open(path, "w") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")
    return doc


def load_app_model(path: str) -> TrustModel:
    doc = json.load(open(path))
    m = TrustModel()
    m.mu, m.sd, m.w, m.b = np.array(doc["mu"]), np.array(doc["sd"]), np.array(doc["w"]), float(doc["b"])
    return m
