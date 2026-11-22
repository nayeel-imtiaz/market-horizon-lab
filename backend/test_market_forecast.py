import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from backend.market import MarketDataError, exchange_schedule, future_dates, load_history
from backend.market_forecast import HORIZONS, horizon_results


class MarketForecastTests(unittest.TestCase):
    def test_forecast_dates_skip_holiday_and_weekend(self):
        self.assertEqual(future_dates(pd.Timestamp("2025-07-03"), 2), ["2025-07-07", "2025-07-08"])

    @patch("backend.market.yf.download")
    def test_lookback_can_extend_before_listing(self, download):
        dates = exchange_schedule("2024-10-10", "2025-07-02").index
        download.return_value = pd.DataFrame({"Close": 20.0, "Adj Close": 20.0}, index=dates)
        now = pd.Timestamp("2025-07-03T16:59:00Z")
        history = load_history("5y", now, symbol="MUU")
        self.assertEqual(history.index[0], pd.Timestamp("2024-10-10"))
        self.assertEqual(download.call_args.args, ("MUU",))

    @patch("backend.market.yf.download")
    def test_excludes_incomplete_session_and_rejects_missing_bar(self, download):
        dates = exchange_schedule("2025-04-02", "2025-07-03").index
        download.return_value = pd.DataFrame({"Close": 20.0, "Adj Close": 20.0}, index=dates)
        before_close = pd.Timestamp("2025-07-03T16:59:00Z")
        self.assertEqual(load_history("3m", before_close).index[-1], pd.Timestamp("2025-07-02"))
        self.assertEqual(download.call_args.kwargs["end"].isoformat(), "2025-07-03")

        after_close = pd.Timestamp("2025-07-03T17:01:00Z")
        self.assertEqual(load_history("3m", after_close).index[-1], pd.Timestamp("2025-07-03"))
        download.return_value = download.return_value.iloc[:-1]
        with self.assertRaises(MarketDataError):
            load_history("3m", after_close)

    def test_future_prices_cannot_change_earlier_backtest_predictions(self):
        dates = pd.bdate_range("2024-01-01", periods=260)
        rng = np.random.default_rng(42)
        history = pd.Series(20 * np.exp(rng.normal(0, .03, len(dates)).cumsum()), index=dates)
        future = future_dates(dates[-1], max(HORIZONS))
        original = horizon_results(history, history.iloc[-1], future)

        changed = history.copy()
        changed.iloc[-1] *= 1.5
        modified = horizon_results(changed, changed.iloc[-1], future)
        for before, after in zip(original, modified, strict=True):
            self.assertEqual(before["predicted_pct"], after["predicted_pct"])
            self.assertNotEqual(before["realized_pct"][-1], after["realized_pct"][-1])
            self.assertEqual(before["target_date"], future[before["sessions"] - 1])

    def test_short_history_disables_long_horizons(self):
        dates = pd.bdate_range("2025-01-01", periods=65)
        history = pd.Series(np.linspace(20, 30, len(dates)), index=dates)
        result = horizon_results(history, history.iloc[-1], future_dates(dates[-1], max(HORIZONS)))
        self.assertIn("forecast_close", result[0])
        self.assertIn("reason", result[-1])
