from contextlib import contextmanager
import os
from threading import BoundedSemaphore
from typing import Literal

import pandas as pd
from fastapi import FastAPI, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from backend.forecast import backtest, demo_data
from backend.market import (
    DEFAULT_SYMBOL, FIRST_LISTED, LOOKBACK_MONTHS, SUPPORTED_SYMBOLS, SYMBOL_GROUPS,
    MarketDataError, future_dates, load_history,
)
from backend.market_forecast import HORIZONS, horizon_results

Model = Literal["perceptron", "ann", "dnn"]
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
LOCAL_ORIGINS = ("http://localhost:3000", "http://127.0.0.1:3000")
forecast_slot = BoundedSemaphore(value=1)


def configure_cors(application, origins):
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[origin.strip().rstrip("/") for origin in origins.split(",") if origin.strip()],
        allow_methods=["GET", "POST"],
    )


app = FastAPI(title="Market Horizon Lab")
configure_cors(app, os.getenv("CORS_ALLOWED_ORIGINS", ",".join(LOCAL_ORIGINS)))


@contextmanager
def forecast_capacity():
    if not forecast_slot.acquire(blocking=False):
        raise HTTPException(
            status_code=503, detail="Another forecast is running. Try again shortly.",
            headers={"Retry-After": "5"},
        )
    try:
        yield
    finally:
        forecast_slot.release()


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/demo")
def run_demo(model: Model = "ann"):
    with forecast_capacity():
        return backtest(demo_data(), model)


@app.post("/upload-csv")
def upload_csv(file: UploadFile, model: Model = Form(...)):
    if file.size is not None and file.size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="CSV must be at most 5 MB.")
    try:
        dataset = pd.read_csv(file.file, nrows=10001)
    except (ValueError, UnicodeError) as error:
        raise HTTPException(status_code=422, detail="Upload a readable UTF-8 CSV.") from error
    try:
        with forecast_capacity():
            return backtest(dataset, model)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/market-symbols")
def market_symbols():
    return SYMBOL_GROUPS


@app.get("/market-forecast")
def market_forecast(
    lookback: Literal["3m", "6m", "1y", "5y"] = "1y",
    symbol: str = DEFAULT_SYMBOL,
):
    symbol = symbol.strip().upper()
    if symbol not in SUPPORTED_SYMBOLS:
        raise HTTPException(status_code=422, detail="Select a supported ticker.")
    try:
        with forecast_capacity():
            bars = load_history(lookback, symbol=symbol)
            as_of = bars.index[-1]
            last_close = float(bars["Close"].iloc[-1])
            horizons = horizon_results(bars["Adj Close"], last_close, future_dates(as_of, max(HORIZONS)))
    except MarketDataError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    requested_start = (as_of - pd.DateOffset(months=LOOKBACK_MONTHS[lookback])).date()
    return {
        "symbol": symbol,
        "history_limited": symbol in FIRST_LISTED and requested_start < FIRST_LISTED[symbol],
        "source": "Yahoo Finance",
        "lookback": lookback,
        "start_date": bars.index[0].date().isoformat(),
        "as_of": as_of.date().isoformat(),
        "last_close": last_close,
        "history_count": len(bars),
        "history_dates": bars.index.strftime("%Y-%m-%d").tolist(),
        "history_close": (bars["Adj Close"] / bars["Adj Close"].iloc[-1] * last_close).tolist(),
        "horizons": horizons,
    }
