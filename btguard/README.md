# BTGuard: continuous trust binding for Bluetooth (prototype)

Combines three methods into one trust score, then acts on it.

| Layer | Method | File |
|---|---|---|
| 1. Prevention | Crypto-state check (LE Secure Connections, key size >= 16, authenticated, encrypted) | `engine.py: crypto_risk` |
| 2. Verification | Physics check: Channel Sounding distance vs RSSI, plus RF fingerprint (CFO) vs enrolled device | `engine.py: proximity_risk` |
| 3. Detection | Tiny explainable ML model on link behaviour (logistic regression, ~5 weights) | `ml.py` |

## Novel contributions, and where to find them

1. **Continuous trust binding.** Trust is re-scored every window, not only at pairing. Quick to lose, slow to earn back (`alpha_down` / `alpha_up`).
2. **Graduated capability.** FULL / RESTRICTED / ISOLATED with different permissions, enforced by `engine.authorize()`.
3. **Automated recovery.** Key ratchet, bond revoked, out-of-band re-pair (HMAC challenge-response), probation after re-pair.
4. **Federated learning.** `federated.py`, FedAvg with optional clipping and noise. Sites share weights, not packets.
5. **Explainable alerts.** Every decision lists reasons (for example "CS distance 1.0 m disagrees with RSSI-implied ~12 m").
6. **Tamper-evident forensics.** Hash-chained log (`forensics.py`).

## Run it (Python 3.9+, numpy only)

    pip install numpy
    python -m btguard demo --log forensic.jsonl     # timeline + evaluation + federated experiment
    python -m unittest tests.test_btguard -v        # 5 tests
    python -m btguard gen --out sample.jsonl        # sample capture format
    python -m btguard replay sample.jsonl           # run the engine on any JSONL capture

## Testing with your own data

`replay` reads one JSON object per line with the fields in `btguard/models.py: Observation`.
The first N rows per device (`--enroll-n`, default 20) are treated as trusted pairing and set the RF fingerprint.

| Field | Where it comes from on real hardware |
|---|---|
| secure_connections, encrypted, authenticated, key_size | HCI / host-stack pairing and encryption events |
| cs_distance_m | Channel Sounding result from a BLE 6.x controller (for example an nRF54L devkit). Use null if absent |
| rssi_dbm | Controller RSSI |
| cfo_khz | Needs a controller or SDR that exposes carrier frequency offset. Many chips do not |
| pkt_rate, pair_attempts, error_rate, iat_jitter_ms | Counters from your sniffer or host stack, per 1 s window |

## Honest limitations

- **All results are from a simulator.** The radio constants (path loss, CFO spread, attack shapes) are my assumptions. 100% detection here does NOT predict real-world performance.
- Relay detection leans on a latency-jitter signature I assumed. Real relays may be stealthier, and the RSSI check alone only caught about a third of simulated relay windows.
- Attackers who know the system can try to evade it (match CFO, mimic traffic). Cryptography stays the foundation.
- The "differential privacy" knob is clipping plus noise, not a formal guarantee.
- No real Bluetooth radio is driven by this code. It is the decision engine, ready for a data source.
- Only test attacks on devices you own, in a controlled lab.

## Next steps toward a product

1. Capture real normal and attack traffic (nRF Sniffer, Ubertooth) and replace the simulator.
2. Port `proximity_risk` + the 5-weight model to C on Zephyr (the math is a few lines).
3. Tune thresholds on real false-positive data, then add a mobile app and fleet dashboard.

## Used by the BlueGuardian app (Phase 7)

The engine is ported to TypeScript in `src/secure/trustEngine.ts` and scores every Secure Link session once a second. The app can only measure link behaviour, so it uses a separate four-feature model:

    python -m btguard export-app-model --out ../src/secure/trustModel.json   # retrain + export weights
    python -m btguard replay-app capture.jsonl                              # score exported session telemetry

See `btguard/app_profile.py` for the feature definitions and assumptions, and [`docs/architecture/SECURE_LINK.md`](../docs/architecture/SECURE_LINK.md) for the full design.
