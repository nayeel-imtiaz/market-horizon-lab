"""Direct forecasts of cumulative log returns at selected session horizons."""

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

HORIZONS = (1, 10, 21, 63)
MIN_TRAINING_ROWS = 30
MIN_EVALUATION_ROWS = 10
MAX_EVALUATION_ROWS = 126


def horizon_results(adjusted, last_close, future_sessions):
    close = adjusted.to_numpy(dtype=float)
    if not np.isfinite(close).all() or (close <= 0).any() or not np.isfinite(last_close) or last_close <= 0:
        raise ValueError("Market history contains invalid closing prices.")

    log_price = np.log(close)
    log_series = pd.Series(log_price)
    returns = log_series.diff()
    features = pd.DataFrame({
        "one_session_return": returns,
        "five_session_return": log_series.diff(5),
        "ten_session_return": log_series.diff(10),
        "five_session_volatility": returns.rolling(5).std(),
        "ten_session_volatility": returns.rolling(10).std(),
    }).dropna().to_numpy()
    offset = len(log_price) - len(features)
    prices = log_price[offset:]

    results = []
    for horizon in HORIZONS:
        target = prices[horizon:] - prices[:-horizon] if len(prices) > horizon else np.array([])
        row = {"sessions": horizon, "target_date": future_sessions[horizon - 1]}
        first_origin = max(
            MIN_TRAINING_ROWS + horizon - 1, len(target) - MAX_EVALUATION_ROWS,
        )
        if len(target) - first_origin < MIN_EVALUATION_ROWS:
            results.append({**row, "reason": "Choose a longer lookback for enough training and evaluation dates."})
            continue

        estimator = make_pipeline(StandardScaler(), Ridge(alpha=10))
        predicted_returns = []
        for origin in range(first_origin, len(target)):
            # Each training label must have reached its target date by this origin.
            train_end = origin - horizon + 1
            estimator.fit(features[:train_end], target[:train_end])
            predicted_returns.append(estimator.predict(features[origin:origin + 1]).item())

        estimator.fit(features[:len(target)], target)
        forward_return = estimator.predict(features[-1:]).item()
        predicted = np.expm1(predicted_returns)
        realized = np.expm1(target[first_origin:])
        model_errors = np.abs(realized - predicted)
        baseline_errors = np.abs(realized)
        origin_dates = adjusted.index[offset + first_origin:len(adjusted) - horizon]
        target_dates = adjusted.index[offset + first_origin + horizon:]
        results.append({
            **row,
            "forecast_close": last_close * np.exp(forward_return),
            "forecast_change_pct": 100 * np.expm1(forward_return),
            "model_mae_pp": 100 * model_errors.mean(),
            "baseline_mae_pp": 100 * baseline_errors.mean(),
            "evaluation_count": len(realized),
            "origin_dates": origin_dates.strftime("%Y-%m-%d").tolist(),
            "target_dates": target_dates.strftime("%Y-%m-%d").tolist(),
            "realized_pct": (100 * realized).tolist(),
            "predicted_pct": (100 * predicted).tolist(),
        })
    return results
