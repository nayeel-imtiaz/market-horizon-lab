"""One-session-ahead forecasts from information available at the prior close."""

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler

MODEL_LAYERS = {"perceptron": (), "ann": (32, 16), "dnn": (64, 32, 16, 8)}
EPOCHS = 60


def backtest(dataset, model):
    if not {"Date", "Close"}.issubset(dataset.columns):
        raise ValueError("CSV must include Date and Close columns.")
    if "Symbol" in dataset and dataset["Symbol"].nunique() > 1:
        raise ValueError("Upload data for one symbol at a time.")

    dates = pd.to_datetime(dataset["Date"], format="%Y-%m-%d", errors="coerce")
    close = pd.to_numeric(dataset["Close"], errors="coerce")
    if dates.isna().any() or dates.duplicated().any():
        raise ValueError("Each Date must be a unique date in YYYY-MM-DD format.")
    if not np.isfinite(close).all() or not close.between(0.000001, 1e9).all():
        raise ValueError("Close must contain positive prices between 0.000001 and 1 billion.")
    if not 60 <= len(dataset) <= 10000:
        raise ValueError("Provide between 60 and 10,000 daily observations.")

    close = pd.Series(close.to_numpy(), index=dates).sort_index()
    previous = close.shift(1)
    returns = close.pct_change()
    features = pd.DataFrame({
        "prior_return": returns.shift(1),
        "five_session_return": close.pct_change(5).shift(1),
        "five_session_volatility": returns.rolling(5).std().shift(1),
    }).dropna()
    actual = close.loc[features.index].to_numpy()
    baseline = previous.loc[features.index].to_numpy()
    changes = actual - baseline

    train_end = int(len(features) * 0.6)
    validation_end = int(len(features) * 0.8)
    train = slice(None, train_end)
    validation = slice(train_end, validation_end)
    test = slice(validation_end, None)
    scaler = StandardScaler().fit(features.iloc[train])
    inputs = scaler.transform(features)
    target_scaler = StandardScaler().fit(changes[train, None])
    targets = target_scaler.transform(changes[:, None]).ravel()
    estimator = MLPRegressor(
        hidden_layer_sizes=MODEL_LAYERS[model],
        random_state=42,
        batch_size=32,
        shuffle=False,
    )

    def predict(partition):
        change = estimator.predict(inputs[partition]).reshape(-1, 1)
        return baseline[partition] + target_scaler.inverse_transform(change).ravel()

    train_loss = []
    validation_loss = []
    for _ in range(EPOCHS):
        estimator.partial_fit(inputs[train], targets[train])
        train_loss.append(mean_squared_error(actual[train], predict(train)))
        validation_loss.append(mean_squared_error(actual[validation], predict(validation)))

    predicted = predict(test)
    return {
        "model": model,
        "dates": features.index[test].strftime("%Y-%m-%d").tolist(),
        "Y_test": actual[test].tolist(),
        "Y_pred": predicted.tolist(),
        "baseline": baseline[test].tolist(),
        "mse": mean_squared_error(actual[test], predicted),
        "mae": mean_absolute_error(actual[test], predicted),
        "baseline_mae": mean_absolute_error(actual[test], baseline[test]),
        "r2": r2_score(actual[test], predicted, force_finite=False)
        if np.ptp(actual[test]) > 0 else None,
        "train loss": train_loss,
        "validation loss": validation_loss,
    }


def demo_data():
    rng = np.random.default_rng(42)
    dates = pd.bdate_range("2023-01-02", periods=360)
    changes = 0.06 + rng.normal(0, 0.85, len(dates))
    return pd.DataFrame({"Date": dates.strftime("%Y-%m-%d"), "Close": 100 + changes.cumsum()})
