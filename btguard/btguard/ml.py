"""Method 3a: tiny explainable behaviour model (logistic regression, numpy only).

Why logistic regression: ~5 weights fit in <100 bytes (trivially portable to a
microcontroller), averaging weights across sites is exact for federated
learning, and every alert decomposes into per-feature contributions (w_i * z_i).
"""
from __future__ import annotations
import numpy as np

FEATURES = ["log_pkt_rate", "pair_attempts", "error_rate", "iat_jitter_ms"]
SD_FLOOR = np.array([0.1, 1.0, 0.01, 0.3])


def featurize(o) -> np.ndarray:
    return np.array([np.log1p(o.pkt_rate), float(o.pair_attempts), o.error_rate, o.iat_jitter_ms])


class TrustModel:
    def __init__(self):
        n = len(FEATURES)
        self.w, self.b = np.zeros(n), 0.0
        self.mu, self.sd = np.zeros(n), np.ones(n)

    def copy(self):
        m = TrustModel()
        m.w, m.b, m.mu, m.sd = self.w.copy(), float(self.b), self.mu.copy(), self.sd.copy()
        return m

    def fit_scaler(self, X_normal):
        self.mu = X_normal.mean(0)
        self.sd = np.maximum(X_normal.std(0), SD_FLOOR)

    def z(self, X):
        return np.clip((np.atleast_2d(X) - self.mu) / self.sd, -6, 6)

    def proba(self, X):
        return 1 / (1 + np.exp(-(self.z(X) @ self.w + self.b)))

    def train(self, X, y, epochs=200, lr=0.05, l2=1e-3):
        Z, n = self.z(X), len(y)
        pos = max(float(y.sum()), 1.0)
        neg = max(n - float(y.sum()), 1.0)
        sw = np.where(y == 1, n / (2 * pos), n / (2 * neg))
        for _ in range(epochs):
            p = 1 / (1 + np.exp(-(Z @ self.w + self.b)))
            g = (p - y) * sw
            self.w -= lr * (Z.T @ g / n + l2 * self.w)
            self.b -= lr * g.mean()
        return self

    def explain(self, x):
        """Per-feature contribution to the malicious score, largest first."""
        z = self.z(x)[0]
        c = self.w * z
        order = np.argsort(-c)
        return [(FEATURES[i], float(z[i]), float(c[i])) for i in order]


def metrics(y, p, thr=0.5):
    pred = p >= thr
    tp = int(((pred == 1) & (y == 1)).sum())
    fp = int(((pred == 1) & (y == 0)).sum())
    fn = int(((pred == 0) & (y == 1)).sum())
    prec = tp / max(tp + fp, 1)
    rec = tp / max(tp + fn, 1)
    f1 = 2 * prec * rec / max(prec + rec, 1e-9)
    return {"precision": prec, "recall": rec, "f1": f1, "fpr": fp / max(int((y == 0).sum()), 1)}
