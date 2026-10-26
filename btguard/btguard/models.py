"""Data model shared by every layer of BTGuard."""
from __future__ import annotations
from dataclasses import dataclass, asdict
from enum import IntEnum
from typing import Optional


class Level(IntEnum):
    """Graduated trust levels (higher = more trusted)."""
    ISOLATED = 0
    RESTRICTED = 1
    FULL = 2


# What a peer may do at each trust level (graduated capability).
CAPABILITIES = {
    Level.FULL: frozenset({"read", "write", "notify", "file_transfer"}),
    Level.RESTRICTED: frozenset({"read", "notify"}),
    Level.ISOLATED: frozenset(),
}


@dataclass
class Observation:
    """One measurement window (~1 s) for one peer device.

    Fields map to things a real BLE stack / controller can expose:
      secure_connections, encrypted, authenticated, key_size -> pairing / link state (HCI events)
      cs_distance_m   -> Channel Sounding distance estimate (BLE 6.x controller), None if unavailable
      rssi_dbm        -> received signal strength
      cfo_khz         -> carrier frequency offset (needs a controller/SDR that exposes it)
      conn_interval_ms, pkt_rate, pair_attempts, error_rate, iat_jitter_ms -> link behaviour
    `label` is ground truth for evaluation only; the engine never reads it.
    """
    device_id: str
    t: float
    secure_connections: bool
    encrypted: bool
    authenticated: bool
    key_size: int
    rssi_dbm: float
    cfo_khz: float
    cs_distance_m: Optional[float]
    conn_interval_ms: float
    pkt_rate: float
    pair_attempts: int
    error_rate: float
    iat_jitter_ms: float
    label: str = "normal"

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d):
        return cls(**d)
