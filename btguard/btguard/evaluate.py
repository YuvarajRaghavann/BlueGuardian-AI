"""Evaluation harness: detection time, false positives, per-layer ablation, federated gain."""
from __future__ import annotations
import random
import numpy as np
from .models import Level
from .simulator import DeviceProfile, stream, enrollment_samples, observe, ATTACKS, BEHAVIORAL
from .ml import TrustModel, featurize, metrics
from .engine import TrustEngine, Config
from .federated import fedavg


def dataset(kinds, n, rng):
    """Behaviour-model training data: label 1 only for behaviour-visible attacks."""
    X, y = [], []
    for k in kinds:
        for i in range(n):
            p = DeviceProfile(f"d{i}", rng)
            o = observe(p, k, 0.0, rng)
            X.append(featurize(o))
            y.append(1 if k in BEHAVIORAL else 0)
    return np.array(X), np.array(y)


def train_global_model(seed=1):
    rng = random.Random(seed)
    Xn, _ = dataset(["normal"], 2000, rng)
    m = TrustModel()
    m.fit_scaler(Xn)
    X, y = dataset(["normal"] * 3 + BEHAVIORAL, 600, rng)
    return m.train(X, y, epochs=1500, lr=0.1)


def run_attack(model, kind, seed, attack=(40, 100), total=140, auto_recover=False):
    rng = random.Random(seed)
    p = DeviceProfile("dev", rng)
    eng = TrustEngine(model, Config(auto_recover=auto_recover))
    eng.enroll("dev", enrollment_samples(p, rng))
    return [eng.process(o) for o in stream(p, rng, [(attack[0], attack[1], kind)] if kind != "normal" else [], total)], attack


def evaluate(model, runs=20):
    out = {"attacks": {}, "fpr": None}
    # false positives on benign-only traffic
    non_full = isolations = n = 0
    for s in range(runs):
        ds, _ = run_attack(model, "normal", 1000 + s)
        non_full += sum(d.level != Level.FULL for d in ds)
        isolations += any(d.level == Level.ISOLATED for d in ds)
        n += len(ds)
    out["fpr"] = {"sample_rate": non_full / n, "runs_with_isolation": isolations, "runs": runs}
    for k in ATTACKS:
        ttd, tti, alerts = [], [], {"crypto": [], "proximity": [], "ml": [], "fused": []}
        for s in range(runs):
            ds, (a, b) = run_attack(model, k, 2000 + s)
            seg = [d for d in ds if a <= d.t < b]
            first = next((d.t - a for d in seg if d.level != Level.FULL), None)
            iso = next((d.t - a for d in seg if d.level == Level.ISOLATED), None)
            if first is not None: ttd.append(first)
            if iso is not None: tti.append(iso)
            for layer, key in (("crypto", "crypto"), ("proximity", "proximity"), ("ml", "ml"), ("fused", "combined")):
                alerts[layer].append(np.mean([d.risks[key] > 0.5 for d in seg]))
        out["attacks"][k] = {
            "detected": len(ttd) / runs, "mean_s_to_restrict": float(np.mean(ttd)) if ttd else None,
            "mean_s_to_isolate": float(np.mean(tti)) if tti else None,
            "per_layer_alert_rate": {l: float(np.mean(v)) for l, v in alerts.items()}}
    return out


def federated_experiment(seed=3):
    rng = random.Random(seed)
    base, _ = dataset(["normal"], 2000, rng)
    proto = TrustModel(); proto.fit_scaler(base)
    sites = {}
    for name, atk in (("site_A(dos only)", "dos_flood"), ("site_B(brute only)", "pair_bruteforce"), ("site_C(relay only)", "relay")):
        sites[name] = dataset(["normal", "normal", atk], 400, rng)
    Xt, yt = dataset(["normal"] * 3 + BEHAVIORAL, 400, rng)
    res = {}
    for name, (X, y) in sites.items():
        m = proto.copy().train(X, y)
        res[name + " local-only"] = metrics(yt, m.proba(Xt))
    g = fedavg(proto, list(sites.values()))
    res["FEDERATED (all sites)"] = metrics(yt, g.proba(Xt))
    gp = fedavg(proto, list(sites.values()), clip=2.0, dp_sigma=0.01)
    res["federated + clip/noise"] = metrics(yt, gp.proba(Xt))
    return res
