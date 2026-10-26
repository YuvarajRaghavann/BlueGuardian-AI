"""Novel contribution 4: federated learning across customer sites.

Sites share *model updates only* (never packets). Optional update clipping +
Gaussian noise gives a differential-privacy-style knob (dp_sigma); it is NOT a
formal DP guarantee without proper accounting.
"""
from __future__ import annotations
import numpy as np


def fedavg(global_model, clients, rounds=20, local_epochs=40, lr=0.05, clip=None, dp_sigma=0.0, seed=0):
    rng = np.random.default_rng(seed)
    g = global_model.copy()
    total = sum(len(y) for _, y in clients)
    for _ in range(rounds):
        dw, db = np.zeros_like(g.w), 0.0
        for X, y in clients:
            m = g.copy()
            m.train(X, y, epochs=local_epochs, lr=lr)
            uw, ub = m.w - g.w, m.b - g.b
            if clip:
                norm = np.sqrt((uw ** 2).sum() + ub ** 2)
                s = min(1.0, clip / max(norm, 1e-12))
                uw, ub = uw * s, ub * s
            if dp_sigma:
                uw = uw + rng.normal(0, dp_sigma, uw.shape)
                ub = ub + rng.normal(0, dp_sigma)
            wgt = len(y) / total
            dw += wgt * uw
            db += wgt * ub
        g.w, g.b = g.w + dw, g.b + db
    return g
