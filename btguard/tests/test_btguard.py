import random, sys, unittest, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from btguard.evaluate import train_global_model, run_attack, evaluate, federated_experiment
from btguard.models import Level
from btguard.engine import TrustEngine, Config
from btguard.simulator import DeviceProfile, enrollment_samples, observe
from btguard.forensics import ForensicLog

MODEL = train_global_model()


class T(unittest.TestCase):
    def test_every_attack_detected_quickly(self):
        for k in ["clone_spoof", "relay", "downgrade", "dos_flood", "pair_bruteforce"]:
            ds, (a, b) = run_attack(MODEL, k, 11)
            iso = [d for d in ds if a <= d.t < b and d.level == Level.ISOLATED]
            self.assertTrue(iso, k)
            self.assertLess(iso[0].t - a, 10, k)

    def test_benign_traffic_never_isolated(self):
        for s in range(15):
            ds, _ = run_attack(MODEL, "normal", 500 + s)
            self.assertFalse(any(d.level == Level.ISOLATED for d in ds))

    def test_recovery_needs_valid_oob_and_enforces_capabilities(self):
        rng = random.Random(3); p = DeviceProfile("x", rng)
        eng = TrustEngine(MODEL, Config()); secret = eng.enroll("x", enrollment_samples(p, rng))
        self.assertTrue(eng.authorize("x", "file_transfer"))
        for t in range(10):
            eng.process(observe(p, "downgrade", float(t), rng))
        self.assertEqual(eng.devices["x"].state, "AWAITING_REPAIR")
        self.assertFalse(eng.authorize("x", "read"))
        ch = eng.new_challenge()
        self.assertFalse(eng.complete_oob_repair("x", ch, b"wrong" * 6))
        self.assertTrue(eng.complete_oob_repair("x", ch, eng.oob_response(secret, ch)))
        self.assertTrue(eng.authorize("x", "read"))
        self.assertFalse(eng.authorize("x", "file_transfer"))   # probation: no file transfer yet

    def test_forensic_chain_detects_tampering(self):
        log = ForensicLog()
        for i in range(5): log.add(float(i), "e", "d", {"i": i})
        self.assertTrue(log.verify())
        log.entries[2]["data"]["i"] = 99
        self.assertFalse(log.verify())

    def test_federated_beats_every_local_model(self):
        r = federated_experiment()
        fed = r["FEDERATED (all sites)"]["recall"]
        for k, v in r.items():
            if "local-only" in k:
                self.assertGreater(fed, v["recall"])


if __name__ == "__main__":
    unittest.main()


class TestAppModel(unittest.TestCase):
    def test_export_round_trip_and_separates_attacks(self):
        import json, os, tempfile
        from btguard.app_profile import export_app_model, load_app_model, app_window, app_featurize
        import random
        path = os.path.join(tempfile.mkdtemp(), "m.json")
        doc = export_app_model(path)
        self.assertEqual(doc["features"], ["log_pkt_rate", "pair_attempts", "error_rate", "rtt_jitter_ms"])
        m = load_app_model(path)
        rng = random.Random(5)
        normal = [float(m.proba(app_featurize(app_window("normal", rng)))[0]) for _ in range(300)]
        flood = [float(m.proba(app_featurize(app_window("frame_flood", rng)))[0]) for _ in range(100)]
        self.assertLess(sum(p >= 0.5 for p in normal) / 300, 0.05)
        self.assertGreater(sum(p >= 0.5 for p in flood) / 100, 0.9)
