"""CLI:  python -m btguard demo | gen | replay | export-app-model | replay-app"""
from __future__ import annotations
import argparse, json, random, sys
from .models import Observation, Level
from .simulator import DeviceProfile, stream, enrollment_samples, ATTACKS
from .engine import TrustEngine, Config
from .evaluate import train_global_model, evaluate, federated_experiment
from .forensics import ForensicLog
from .app_profile import export_app_model, load_app_model, app_featurize


def _hdr(s): print("\n" + "=" * 78 + f"\n{s}\n" + "=" * 78)


def cmd_demo(a):
    _hdr("1) Train the behaviour model (vendor side) and check it")
    model = train_global_model()
    print("weights:", {n: round(float(w), 2) for n, w in zip(["log_pkt_rate", "pair_attempts", "error_rate", "iat_jitter_ms"], model.w)}, "bias", round(float(model.b), 2))

    _hdr("2) Live timeline: RELAY attack t=30-60, then OOB re-pair at t=75 (recovery + probation)")
    rng = random.Random(7)
    p = DeviceProfile("watch-01", rng)
    log = ForensicLog(a.log)
    eng = TrustEngine(model, Config(), log)
    secret = eng.enroll("watch-01", enrollment_samples(p, rng))
    repaired = False
    last = None
    for o in stream(p, rng, [(30, 60, "relay")], 130):
        if o.t == 75 and not repaired:
            ch = eng.new_challenge()
            ok = eng.complete_oob_repair("watch-01", ch, eng.oob_response(secret, ch), o.t)
            print(f"t={o.t:5.0f}  >>> user re-pairs device via QR/NFC (OOB) -> {'OK' if ok else 'FAILED'}")
            repaired = True
        d = eng.process(o)
        if d.level != last or d.actions or (int(o.t) % 15 == 0):
            flag = "  [" + o.label + "]" if o.label != "normal" else ""
            print(f"t={o.t:5.0f}  trust={d.trust:5.1f}  {d.level.name:<10} can={sorted(d.capabilities)}{flag}")
            for r in d.reasons[:3]: print(f"           why: {r}")
            for act in d.actions: print(f"           ACTION: {act}")
        last = d.level
    print("\nforensic log entries:", len(log.entries), "| hash chain valid:", log.verify())
    if a.log: print("written to", a.log)

    _hdr("3) Evaluation on simulated traffic (20 runs per attack, 140 s each)")
    r = evaluate(model, runs=20)
    f = r["fpr"]
    print(f"Benign-only traffic: {100*f['sample_rate']:.1f}% of seconds below FULL trust; "
          f"{f['runs_with_isolation']}/{f['runs']} runs ever isolated")
    print(f"\n{'attack':<16}{'detected':>9}{'s->restrict':>13}{'s->isolate':>12}   per-layer alert rate (crypto / physics / ML / FUSED)")
    for k, v in r["attacks"].items():
        l = v["per_layer_alert_rate"]
        print(f"{k:<16}{100*v['detected']:>8.0f}%{v['mean_s_to_restrict']:>13.1f}{v['mean_s_to_isolate']:>12.1f}   "
              f"{l['crypto']:.2f} / {l['proximity']:.2f} / {l['ml']:.2f} / {l['fused']:.2f}")
    print("\n-> No single layer covers every attack; the fused score does. That is the case for combining them.")

    _hdr("4) Federated learning: each site sees only ONE attack type")
    fr = federated_experiment()
    print(f"{'model':<28}{'precision':>10}{'recall':>8}{'F1':>7}{'FPR':>7}")
    for k, m in fr.items():
        print(f"{k:<28}{m['precision']:>10.2f}{m['recall']:>8.2f}{m['f1']:>7.2f}{m['fpr']:>7.3f}")
    print("\nNOTE: all numbers come from a simulator with stated assumptions. Validate on real captures.")


def cmd_gen(a):
    rng = random.Random(a.seed)
    with open(a.out, "w") as f:
        for i in range(a.devices):
            p = DeviceProfile(f"dev-{i}", rng)
            for o in enrollment_samples(p, rng, 20): f.write(json.dumps(o.to_dict()) + "\n")
            sched = [(40, 90, ATTACKS[i % len(ATTACKS)])]
            for o in stream(p, rng, sched, 130): f.write(json.dumps(o.to_dict()) + "\n")
    print("wrote", a.out)


def cmd_replay(a):
    """Feed your own capture (JSONL, one Observation per line; see `gen` for the format)."""
    rows = [Observation.from_dict(json.loads(l)) for l in open(a.file) if l.strip()]
    by = {}
    for o in rows: by.setdefault(o.device_id, []).append(o)
    model = train_global_model()
    log = ForensicLog(a.log)
    eng = TrustEngine(model, Config(), log)
    for dev, obs in by.items():
        eng.enroll(dev, obs[:a.enroll_n])          # first N rows are assumed to be trusted pairing
        worst, last = Level.FULL, None
        for o in obs[a.enroll_n:]:
            d = eng.process(o)
            if d.level != last:
                print(f"{dev} t={o.t:.0f} -> {d.level.name} (trust {d.trust:.0f})  " + "; ".join(d.reasons[:2]))
                last = d.level
            worst = min(worst, d.level)
        print(f"{dev}: worst level reached = {worst.name}\n")
    print("forensic hash chain valid:", log.verify())


def cmd_export_app_model(a):
    doc = export_app_model(a.out, a.seed)
    print("wrote", a.out)
    for k, v in doc["simulatorEvaluation"].items():
        print(f"  {k:<36}{v:.3f}")
    print("NOTE: simulator numbers only. Validate on real two-phone captures before claiming accuracy.")


def cmd_replay_app(a):
    """Score a Secure Link telemetry capture (JSONL rows exported from the app's forensic log)."""
    m = load_app_model(a.model)
    flagged = total = 0
    for line in open(a.file):
        if not line.strip():
            continue
        w = json.loads(line)
        p = float(m.proba(app_featurize(w))[0])
        total += 1
        flagged += p >= 0.5
        if p >= 0.5:
            print(f"t={w.get('t', '?')}  ML score {p:.2f}  {w}")
    print(f"{flagged}/{total} windows flagged")


def main():
    ap = argparse.ArgumentParser(prog="btguard")
    sp = ap.add_subparsers(dest="cmd", required=True)
    d = sp.add_parser("demo"); d.add_argument("--log", default=None); d.set_defaults(fn=cmd_demo)
    g = sp.add_parser("gen"); g.add_argument("--out", default="sample.jsonl"); g.add_argument("--devices", type=int, default=5); g.add_argument("--seed", type=int, default=1); g.set_defaults(fn=cmd_gen)
    r = sp.add_parser("replay"); r.add_argument("file"); r.add_argument("--enroll-n", type=int, default=20); r.add_argument("--log", default=None); r.set_defaults(fn=cmd_replay)
    e = sp.add_parser("export-app-model"); e.add_argument("--out", default="trustModel.json"); e.add_argument("--seed", type=int, default=3); e.set_defaults(fn=cmd_export_app_model)
    ra = sp.add_parser("replay-app"); ra.add_argument("file"); ra.add_argument("--model", default="../src/secure/trustModel.json"); ra.set_defaults(fn=cmd_replay_app)
    a = ap.parse_args(); a.fn(a)


if __name__ == "__main__":
    main()
