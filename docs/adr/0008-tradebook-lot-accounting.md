# 8. Tradebook import and FIFO lot accounting

**Status:** accepted

## Context
Kite's API returns current holdings with an average price, but no trade history. Without dated trades there is no XIRR, no realised P&L and no short-term/long-term split. Zerodha Console exports the full tradebook as CSV.

## Decision
- **Import** the Console CSV into a `trades` table. Columns are matched by header name (case-insensitive, with aliases). The unique key `(exchange, trade_date, symbol, trade_id)` makes re-importing overlapping files a no-op for rows already present.
- **Identity:** positions are keyed by NSE symbol, resolved from ISIN (the file's NSE rows, then the Nifty 500 list, then recent bhavcopies). A stock bought on BSE and sold on NSE is one position, and a face-value split that issues a new ISIN does not break history.
- **Accounting** (`matchLots` in core, pure and unit-tested), per stock and day:
  1. corporate actions with that ex-date, applied before the day's trades;
  2. same-day buys and sells net off as intraday;
  3. remaining sells close the oldest lots first (FIFO). Held over 12 months = long-term.
- **Splits rescale lots** (same date, cost spread). **Bonus shares are a new zero-cost lot dated at allotment**, as Indian tax treats them. The two are separated from combined purposes such as "FV SPLT FRM RS 2 TO RE 1 / BONUS 1:2".
- **Reconciliation:** open lots are compared with the broker's holdings. Differences (IPO allotments, transfers, an export that starts too late) and sells with no recorded purchase are shown, never papered over.

## Consequences
- XIRR, realised P&L and the financial-year gain split come from the user's own data.
- Not modelled: charges and STT, dividends, rights, the 31-Jan-2018 grandfathering, demergers. The page says so; the numbers are for records, not a tax filing.
- Uploads go through a 4.5 MB serverless body limit, roughly 30k trades.
