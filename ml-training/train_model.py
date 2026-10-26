#!/usr/bin/env python3
"""Leakage-aware supervised training for BlueGuardian's 11-feature telemetry schema.

This script deliberately refuses to create a model from generated/synthetic rows.
Input labels must come from reviewed, documented observations. Device groups are
split before training to reduce the chance of the same physical device appearing
in both train and test.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import GroupShuffleSplit
from sklearn.utils.class_weight import compute_sample_weight

FEATURES = [
    "normalizedTrustScore",
    "normalizedRSSI",
    "knownFlag",
    "trustedFlag",
    "explicitlyBlockedFlag",
    "serviceCountNorm",
    "independentSecurityIndicatorCountNorm",
    "suspiciousNameFlag",
    "connectionStatusFlag",
    "deviceTypeRisk",
    "discoverySourceFlag",
]
ALLOWED_LABELS = {
    "BENIGN",
    "SUSPICIOUS",
    "POTENTIAL_SPOOFING",
    "POTENTIAL_UNAUTHORIZED_ACCESS",
    "ANOMALOUS_BEHAVIOR",
    "HIGH_RISK_DEVICE",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True, help="Curated CSV with features, label, and device_group")
    parser.add_argument("--out", default="ml-training/output", help="Output directory")
    parser.add_argument("--test-size", type=float, default=0.25)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    if not 0.1 <= args.test_size <= 0.4:
        raise SystemExit("--test-size must be between 0.1 and 0.4")

    data = pd.read_csv(args.csv)
    required = ["device_group", "label", *FEATURES]
    missing = sorted(set(required) - set(data.columns))
    if missing:
        raise SystemExit(f"Missing required CSV columns: {', '.join(missing)}")
    if len(data) < 100:
        raise SystemExit("Refusing to train on fewer than 100 reviewed observations.")
    if data["device_group"].isna().any() or (data["device_group"].astype(str).str.strip() == "").any():
        raise SystemExit("Every row must have a non-empty device_group for leakage-aware splitting.")
    if data["label"].isna().any():
        raise SystemExit("Every row needs a reviewed ground-truth label.")
    unknown = sorted(set(data["label"].astype(str)) - ALLOWED_LABELS)
    if unknown:
        raise SystemExit(f"Unsupported labels: {', '.join(unknown)}")

    x = data[FEATURES].apply(pd.to_numeric, errors="coerce")
    if x.isna().any().any():
        raise SystemExit("Feature columns must contain finite numeric values; do not silently impute missing telemetry.")
    if ((x < 0) | (x > 1)).any().any():
        raise SystemExit("All normalized features must be in the inclusive range 0..1.")
    y = data["label"].astype(str)
    groups = data["device_group"].astype(str)

    if groups.nunique() < 4:
        raise SystemExit("At least four distinct device_group values are required for a useful hold-out split.")

    splitter = GroupShuffleSplit(n_splits=20, test_size=args.test_size, random_state=args.seed)
    selected: tuple[Any, Any] | None = None
    for train_idx, test_idx in splitter.split(x, y, groups):
        train_classes = set(y.iloc[train_idx])
        test_classes = set(y.iloc[test_idx])
        if len(train_classes) >= 2 and len(test_classes) >= 2 and test_classes.issubset(train_classes):
            selected = (train_idx, test_idx)
            break
    if selected is None:
        raise SystemExit("Could not find a group-separated split with at least two represented classes. Collect more reviewed device groups.")

    train_idx, test_idx = selected
    model = RandomForestClassifier(
        n_estimators=300,
        max_depth=12,
        min_samples_leaf=3,
        class_weight="balanced_subsample",
        random_state=args.seed,
        n_jobs=-1,
    )
    weights = compute_sample_weight(class_weight="balanced", y=y.iloc[train_idx])
    model.fit(x.iloc[train_idx], y.iloc[train_idx], sample_weight=weights)
    predicted = model.predict(x.iloc[test_idx])
    labels = sorted(set(y.iloc[train_idx]) | set(y.iloc[test_idx]))

    tn = fp = 0
    binary_true = y.iloc[test_idx].isin(["BENIGN"]).to_numpy()
    binary_pred = pd.Series(predicted).isin(["BENIGN"]).to_numpy()
    tn = int((binary_true & binary_pred).sum())
    fp = int((~binary_true & binary_pred).sum())
    false_benign_rate = fp / max(1, fp + int((~binary_true & ~binary_pred).sum()))

    output = Path(args.out)
    output.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, output / "blueguardian-random-forest.joblib")
    metrics = {
        "schemaVersion": "1.0",
        "model": "RandomForestClassifier",
        "seed": args.seed,
        "featureOrder": FEATURES,
        "labels": labels,
        "rows": int(len(data)),
        "trainRows": int(len(train_idx)),
        "testRows": int(len(test_idx)),
        "trainDeviceGroups": int(groups.iloc[train_idx].nunique()),
        "testDeviceGroups": int(groups.iloc[test_idx].nunique()),
        "overlappingDeviceGroups": sorted(set(groups.iloc[train_idx]) & set(groups.iloc[test_idx])),
        "accuracy": float(accuracy_score(y.iloc[test_idx], predicted)),
        "macroPrecision": float(precision_score(y.iloc[test_idx], predicted, average="macro", zero_division=0)),
        "macroRecall": float(recall_score(y.iloc[test_idx], predicted, average="macro", zero_division=0)),
        "macroF1": float(f1_score(y.iloc[test_idx], predicted, average="macro", zero_division=0)),
        "falseBenignRate": float(false_benign_rate),
        "confusionMatrix": confusion_matrix(y.iloc[test_idx], predicted, labels=labels).tolist(),
        "classificationReport": classification_report(y.iloc[test_idx], predicted, labels=labels, output_dict=True, zero_division=0),
        "note": "Metrics are only valid for this curated dataset and group split. They are not a claim of general real-world accuracy.",
    }
    (output / "evaluation.json").write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: metrics[k] for k in ["rows","trainRows","testRows","trainDeviceGroups","testDeviceGroups","accuracy","macroPrecision","macroRecall","macroF1","falseBenignRate"]}, indent=2))


if __name__ == "__main__":
    main()
