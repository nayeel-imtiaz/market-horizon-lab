import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import main
from backend.market import MarketDataError


@pytest.fixture
def client():
    with TestClient(main.app) as client:
        yield client


def test_health_is_independent_of_market_data_and_compute(client, monkeypatch):
    def unavailable(*args, **kwargs):
        pytest.fail("Health made a market data request")

    monkeypatch.setattr(main, "load_history", unavailable)
    with main.forecast_capacity():
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_forecast_uses_mocked_history(client, monkeypatch):
    dates = pd.bdate_range("2024-01-01", periods=260)
    prices = 50 * np.exp(np.random.default_rng(42).normal(0, 0.02, len(dates)).cumsum())

    def history(lookback, *, symbol):
        assert (lookback, symbol) == ("1y", "MUU")
        return pd.DataFrame({"Close": prices, "Adj Close": prices}, index=dates)

    monkeypatch.setattr(main, "load_history", history)
    response = client.get("/market-forecast", params={"symbol": "muu"})
    assert response.status_code == 200
    result = response.json()
    assert result["symbol"] == "MUU"
    assert result["history_count"] == 260
    assert result["as_of"] == dates[-1].date().isoformat()
    assert result["last_close"] == prices[-1]
    assert [row["sessions"] for row in result["horizons"]] == [1, 10, 21, 63]
    for row in result["horizons"]:
        assert row["target_date"] > result["as_of"]
        assert row["forecast_close"] > 0
        assert len(row["target_dates"]) == row["evaluation_count"]
        assert row["baseline_mae_pp"] == pytest.approx(np.abs(row["realized_pct"]).mean())


@pytest.mark.parametrize("query", ["symbol=BAD", "lookback=3y"])
def test_invalid_forecast_requests_do_not_fetch_history(client, monkeypatch, query):
    def unexpected(*args, **kwargs):
        pytest.fail("Invalid request reached the market provider")

    monkeypatch.setattr(main, "load_history", unexpected)
    assert client.get(f"/market-forecast?{query}").status_code == 422


def test_provider_failure_returns_retryable_error(client, monkeypatch):
    def unavailable(*args, **kwargs):
        raise MarketDataError("Provider unavailable. Try again shortly.")

    monkeypatch.setattr(main, "load_history", unavailable)
    response = client.get("/market-forecast")
    assert response.status_code == 503
    assert response.json()["detail"] == "Provider unavailable. Try again shortly."


def test_busy_service_returns_retry_after(client):
    with main.forecast_capacity():
        response = client.get("/market-forecast")
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "5"


def test_csv_requires_valid_form_and_columns(client):
    assert client.post("/upload-csv").status_code == 422
    response = client.post(
        "/upload-csv",
        data={"model": "ann"},
        files={"file": ("prices.csv", b"Price\n100\n", "text/csv")},
    )
    assert response.status_code == 422
    assert "Date and Close" in response.json()["detail"]


def test_cors_allows_only_configured_origins():
    app = FastAPI()
    main.configure_cors(app, " https://demo.vercel.app/, https://other.example.com ")
    with TestClient(app) as client:
        for origin, status in [("https://demo.vercel.app", 200), ("https://unknown.example.com", 400)]:
            response = client.options(
                "/upload-csv",
                headers={"Origin": origin, "Access-Control-Request-Method": "POST"},
            )
            assert response.status_code == status
            assert response.headers.get("Access-Control-Allow-Origin") == (origin if status == 200 else None)
