"""Unit tests for split discipline and missing telemetry handling (not model-accuracy tests)."""
from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from ml_training.train_ble_flood_model import (
    FEATURE_COLUMNS,
    find_group_split,
    imputation_values,
    impute,
)


class TrainingPipelineTests(unittest.TestCase):
    def _tiny_windows(self) -> tuple[pd.DataFrame, pd.Series, pd.Series]:
        values = []
        labels = []
        groups = []
        for label, base in [("benign", 5.0), ("ble_flood", 50.0)]:
            for capture_index in range(2):
                session = f"{label}-session-{capture_index}"
                for window_index in range(6):
                    row = {name: base + window_index for name in FEATURE_COLUMNS}
                    row["rssi_mean"] = np.nan if window_index % 2 else -70.0
                    row["rssi_std"] = np.nan
                    values.append(row)
                    labels.append(label)
                    groups.append(session)
        return pd.DataFrame(values), pd.Series(labels), pd.Series(groups)

    def test_holdout_keeps_whole_sessions_separate_and_both_labels_present(self) -> None:
        frame, labels, groups = self._tiny_windows()
        train, test = find_group_split(frame, labels, groups, test_size=0.25, seed=42)
        self.assertTrue(set(groups.iloc[train]).isdisjoint(set(groups.iloc[test])))
        self.assertEqual(set(labels.iloc[train]), {"benign", "ble_flood"})
        self.assertEqual(set(labels.iloc[test]), {"benign", "ble_flood"})

    def test_missing_rssi_is_imputed_using_training_values_only(self) -> None:
        frame, labels, groups = self._tiny_windows()
        train, _ = find_group_split(frame, labels, groups, test_size=0.25, seed=42)
        fill = imputation_values(frame.iloc[train])
        transformed = impute(frame, fill)
        self.assertTrue(np.isfinite(transformed.to_numpy()).all())
        self.assertEqual(list(transformed.columns), FEATURE_COLUMNS)
        self.assertEqual(fill["rssi_mean"], -70.0)
        self.assertEqual(fill["rssi_std"], 0.0)

    def test_split_fails_when_there_are_too_few_independent_sessions(self) -> None:
        frame, labels, groups = self._tiny_windows()
        selected = groups == "benign-session-0"
        with self.assertRaisesRegex(ValueError, "At least 4 sessions"):
            find_group_split(frame[selected], labels[selected], groups[selected], 0.25, 42)


if __name__ == "__main__":
    unittest.main()
