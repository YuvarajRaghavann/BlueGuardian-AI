"""The combination: Method 1 (crypto) + Method 2 (physics) + Method 3 (ML) -> one trust score.

Novel contributions implemented here:
  1. Continuous trust binding  - trust is re-scored every window; a drop mid-session
                                 triggers key rotation, not just a check at pairing.
  2. Graduated capability      - FULL / RESTRICTED / ISOLATED, enforced by authorize().
  3. Automated recovery        - rotate key, revoke bond, require OOB re-pair, log it.
  5. Explainable alerts        - every decision carries human-readable reasons.
(4 = federated learning, see federated.py)
"""
from __future__ import annotations
import hashlib, hmac, math, os
from dataclasses import dataclass, field
import numpy as np
from .models import Level, CAPABILITIES, Observation
from .ml import featurize
from .forensics import ForensicLog
from .simulator import REF_RSSI, PATH_LOSS_N


@dataclass
class Config:
    ml_weight: float = 0.9
    crypto_hard: float = 0.9      # crypto risk at/above this caps trust (hard gate)
    crypto_cap: float = 30.0
    alpha_down: float = 0.6       # trust is quick to lose ...
    alpha_up: float = 0.08        # ... and slow to earn back
    initial_trust: float = 80.0
    down_thr: tuple = (40.0, 70.0)   # below 40 -> ISOLATED, below 70 -> RESTRICTED
    up_thr: tuple = (45.0, 75.0)     # hysteresis on the way up
    rssi_sigma_db: float = 4.0       # shadowing + multipath tolerance
    min_cfo_sd: float = 0.8
    probation_trust: float = 55.0
    auto_recover: bool = True


@dataclass
class DeviceState:
    device_id: str
    cfo_mu: float
    cfo_sd: float
    secret: bytes                 # provisioned out-of-band (QR / NFC / factory)
    key: bytes
    key_counter: int = 0
    trust: float = 80.0
    level: Level = Level.FULL
    state: str = "ACTIVE"         # or AWAITING_REPAIR
    bonded: bool = True


@dataclass
class Decision:
    t: float
    device_id: str
    trust: float
    inst_trust: float
    level: Level
    capabilities: frozenset
    risks: dict
    reasons: list
    actions: list = field(default_factory=list)


def _clip(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def crypto_risk(o: Observation):
    """Method 1: is the link cryptographically sound?"""
    r, why = 0.0, []
    if not o.encrypted:
        r, why = max(r, 1.0), why + ["link is not encrypted"]
    if o.key_size < 16:
        r, why = max(r, 0.95), why + [f"encryption key only {o.key_size} bytes (<16): downgrade / KNOB-style"]
    if not o.secure_connections:
        r, why = max(r, 0.85), why + ["legacy pairing in use (no LE Secure Connections)"]
    if not o.authenticated:
        r, why = max(r, 0.5), why + ["unauthenticated pairing (no MITM protection)"]
    return r, why


def proximity_risk(o: Observation, st: DeviceState, cfg: Config):
    """Method 2: does the radio physics agree with the claimed identity and place?"""
    why, r_dist, r_fp = [], 0.0, 0.0
    if o.cs_distance_m is not None:
        expected = REF_RSSI - 10 * PATH_LOSS_N * math.log10(max(o.cs_distance_m, 0.1))
        res = o.rssi_dbm - expected
        z = abs(res) / cfg.rssi_sigma_db
        r_dist = _clip((z - 2.5) / 3.0)
        if r_dist > 0.3:
            implied = 10 ** ((REF_RSSI - o.rssi_dbm) / (10 * PATH_LOSS_N))
            why.append(f"CS distance {o.cs_distance_m:.1f} m disagrees with RSSI-implied ~{implied:.1f} m (possible relay)")
    zf = abs(o.cfo_khz - st.cfo_mu) / st.cfo_sd
    r_fp = _clip((zf - 3.0) / 4.0)
    if r_fp > 0.3:
        why.append(f"RF fingerprint mismatch: CFO {o.cfo_khz:.1f} kHz vs enrolled {st.cfo_mu:.1f} kHz ({zf:.1f} sd): possible clone")
    return max(r_dist, r_fp), r_dist, r_fp, why


class TrustEngine:
    def __init__(self, model, cfg: Config | None = None, log: ForensicLog | None = None):
        self.model, self.cfg = model, cfg or Config()
        self.log = log or ForensicLog()
        self.devices: dict[str, DeviceState] = {}

    # ---- enrollment (during trusted, out-of-band pairing) -----------------
    def enroll(self, device_id, samples, secret: bytes | None = None) -> bytes:
        cfo = np.array([s.cfo_khz for s in samples])
        secret = secret or os.urandom(16)
        st = DeviceState(device_id, float(cfo.mean()), max(float(cfo.std()) * 1.2, self.cfg.min_cfo_sd),
                         secret, os.urandom(16), trust=self.cfg.initial_trust)
        self.devices[device_id] = st
        self.log.add(0.0, "enrolled", device_id, {"cfo_mu": round(st.cfo_mu, 2), "cfo_sd": round(st.cfo_sd, 2)})
        return secret

    # ---- continuous scoring ----------------------------------------------
    def process(self, o: Observation) -> Decision:
        st, cfg = self.devices[o.device_id], self.cfg
        if st.state == "AWAITING_REPAIR":
            return Decision(o.t, o.device_id, st.trust, 0.0, Level.ISOLATED, frozenset(),
                            {"crypto": 0.0, "proximity": 0.0, "ml": 0.0, "combined": 1.0},
                            ["bond revoked; waiting for out-of-band re-pair"])
        rc, why_c = crypto_risk(o)
        rp, r_dist, r_fp, why_p = proximity_risk(o, st, cfg)
        x = featurize(o)
        p_ml = float(self.model.proba(x)[0])
        rm = _clip((p_ml - 0.15) / 0.85)      # dead-zone: ignore low-confidence ML noise
        why_m = []
        if rm > 0.2:
            for name, z, c in self.model.explain(x)[:2]:
                if c > 0.2:
                    why_m.append(f"behaviour: {name} is {z:+.1f} sd from normal (ML score {p_ml:.2f})")
        combined = 1 - (1 - rc) * (1 - rp) * (1 - cfg.ml_weight * rm)
        inst = 100 * (1 - combined)
        if rc >= cfg.crypto_hard:
            inst = min(inst, cfg.crypto_cap)
        a = cfg.alpha_down if inst < st.trust else cfg.alpha_up
        st.trust = a * inst + (1 - a) * st.trust

        new = self._next_level(st)
        actions = []
        if new != st.level:
            actions.append(f"level {st.level.name} -> {new.name}")
            self.log.add(o.t, "level_change", o.device_id,
                         {"from": st.level.name, "to": new.name, "trust": round(st.trust, 1),
                          "reasons": why_c + why_p + why_m})
            old, st.level = st.level, new
            if new == Level.ISOLATED and cfg.auto_recover:
                actions += self._recover(st, o.t)
        reasons = why_c + why_p + why_m
        return Decision(o.t, o.device_id, st.trust, inst, st.level, CAPABILITIES[st.level],
                        {"crypto": rc, "proximity": rp, "dist": r_dist, "fingerprint": r_fp, "ml": rm, "combined": combined},
                        reasons, actions)

    def _next_level(self, st: DeviceState) -> Level:
        c, t = self.cfg, st.trust
        down = Level.ISOLATED if t < c.down_thr[0] else Level.RESTRICTED if t < c.down_thr[1] else Level.FULL
        up = Level.ISOLATED if t < c.up_thr[0] else Level.RESTRICTED if t < c.up_thr[1] else Level.FULL
        if down < st.level:
            return down                # losing trust is immediate
        if up > st.level:
            return Level(st.level + 1) if up > st.level + 1 else up   # regain one step at a time
        return st.level

    # ---- automated recovery ---------------------------------------------
    def _recover(self, st: DeviceState, t: float):
        st.key_counter += 1
        st.key = hmac.new(st.key, b"btguard-rotate" + st.key_counter.to_bytes(4, "big"), hashlib.sha256).digest()[:16]
        st.bonded, st.state = False, "AWAITING_REPAIR"
        self.log.add(t, "recovery", st.device_id,
                     {"actions": ["session key rotated", "bond revoked", "OOB re-pair required"], "key_epoch": st.key_counter})
        return ["session key rotated", "bond revoked", "OOB re-pair required"]

    def new_challenge(self) -> bytes:
        return os.urandom(16)

    @staticmethod
    def oob_response(secret: bytes, challenge: bytes) -> bytes:
        return hmac.new(secret, challenge, hashlib.sha256).digest()

    def complete_oob_repair(self, device_id, challenge, response, t=0.0) -> bool:
        st = self.devices[device_id]
        if st.state != "AWAITING_REPAIR":
            return False
        if not hmac.compare_digest(self.oob_response(st.secret, challenge), response):
            self.log.add(t, "repair_failed", device_id, {})
            return False
        st.key, st.bonded, st.state = os.urandom(16), True, "ACTIVE"
        st.trust, st.level = self.cfg.probation_trust, Level.RESTRICTED
        self.log.add(t, "repaired", device_id, {"probation_trust": st.trust})
        return True

    # ---- graduated capability enforcement -------------------------------
    def authorize(self, device_id, operation) -> bool:
        st = self.devices[device_id]
        return st.state == "ACTIVE" and operation in CAPABILITIES[st.level]
