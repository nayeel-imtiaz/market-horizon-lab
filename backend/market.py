"""Load completed daily U.S. market bars and date forecasts on the exchange calendar."""

from datetime import date, timedelta

import pandas as pd
import pandas_market_calendars as mcal
import yfinance as yf

DEFAULT_SYMBOL = "SOXL"
SYMBOL_GROUPS = {
    "Leveraged products": {
        "SOXL": "Direxion Semiconductor Bull 3X ETF",
        "MUU": "Direxion Micron Bull 2X ETF",
        "GDXU": "MicroSectors Gold Miners 3X ETN",
    },
    "Semiconductors": {
        "NVDA": "NVIDIA",
        "MU": "Micron Technology",
        "INTC": "Intel",
        "AMD": "Advanced Micro Devices",
        "AVGO": "Broadcom",
        "QCOM": "Qualcomm",
        "TSM": "Taiwan Semiconductor (U.S. ADR)",
        "ASML": "ASML (U.S. listing)",
        "AMAT": "Applied Materials",
        "LRCX": "Lam Research",
        "KLAC": "KLA",
    },
    "Big tech": {
        "GOOGL": "Alphabet (Class A)",
        "AAPL": "Apple",
        "MSFT": "Microsoft",
        "AMZN": "Amazon",
        "META": "Meta Platforms",
        "NFLX": "Netflix",
        "TSLA": "Tesla",
    },
}
SUPPORTED_SYMBOLS = {symbol for group in SYMBOL_GROUPS.values() for symbol in group}
FIRST_LISTED = {"MUU": date(2024, 10, 10), "GDXU": date(2020, 12, 2)}
LOOKBACK_MONTHS = {"3m": 3, "6m": 6, "1y": 12, "5y": 60}
CALENDAR = mcal.get_calendar("NYSE")


class MarketDataError(Exception):
    """The provider did not supply a usable daily history."""


def exchange_schedule(start, end):
    return CALENDAR.schedule(start_date=start, end_date=end)


def load_history(lookback, now=None, *, symbol=DEFAULT_SYMBOL):
    now = pd.Timestamp.now(tz="UTC") if now is None else now
    local_date = now.tz_convert("America/New_York").date()
    schedule = exchange_schedule(local_date - timedelta(days=14), local_date)
    completed = schedule.index[schedule["market_close"] <= now][-1]
    start = (completed - pd.DateOffset(months=LOOKBACK_MONTHS[lookback])).date()
    start = max(start, FIRST_LISTED.get(symbol, start))
    end = completed.date() + timedelta(days=1)
    try:
        bars = yf.download(
            symbol, start=start, end=end, interval="1d", auto_adjust=False,
            progress=False, threads=False, multi_level_index=False, timeout=10,
        )
    except Exception as error:
        raise MarketDataError(f"Yahoo Finance could not return {symbol} history. Try again shortly.") from error
    if bars is None or bars.empty or not {"Close", "Adj Close"}.issubset(bars.columns):
        raise MarketDataError(f"Yahoo Finance returned no usable {symbol} data. Try again shortly.")

    bars.index = pd.DatetimeIndex(bars.index).tz_localize(None).normalize()
    expected = exchange_schedule(start, completed.date()).index
    bars = bars.loc[bars.index.intersection(expected)].sort_index()
    if not bars.index.equals(expected):
        raise MarketDataError(
            f"{symbol} history is missing completed session data through {completed.date()}. "
            "Try again after the provider updates its daily bars."
        )
    return bars


def future_dates(as_of, count):
    sessions = exchange_schedule(as_of + timedelta(days=1), as_of + timedelta(days=180))
    return sessions.index[:count].strftime("%Y-%m-%d").tolist()
