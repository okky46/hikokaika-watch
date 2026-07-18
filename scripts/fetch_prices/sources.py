"""Replaceable market-data source for the daily closing-price job."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

SOURCE_NAME = "yfinance"


def fetch_close(security_code: str, price_date: date) -> Decimal | None:
    """Return the unadjusted TSE close for ``security_code`` on ``price_date``.

    yfinance is deliberately imported here rather than by the batch runner, so a
    future source can replace this one function without changing batch logic.
    ``security_code`` remains a string: codes such as ``130A`` must become
    ``130A.T``, never a parsed or zero-padded number.
    """
    try:
        ticker = f"{security_code}.T"
        print(f"[price-fetch] fetching {ticker} for {price_date}")
        import yfinance as yf
    except ImportError:
        print("[price-fetch] yfinance is unavailable; run pip install -r requirements.txt")
        return None

    try:
        # end is exclusive. auto_adjust=False is required to use the raw close.
        history = yf.Ticker(ticker).history(
            start=price_date,
            end=price_date + timedelta(days=1),
            auto_adjust=False,
            timeout=10,
        )
        if history.empty or "Close" not in history:
            print(f"[price-fetch] {ticker} {price_date}: close unavailable")
            return None

        # str() prevents a binary float from being passed into Decimal directly.
        close = Decimal(str(history["Close"].iloc[-1]))
        return close.quantize(Decimal("0.01"))
    except Exception as error:
        print(f"[price-fetch] {ticker} {price_date}: fetch failed ({type(error).__name__})")
        return None
