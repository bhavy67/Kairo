# 6. Adjust for corporate actions at read time

**Status:** accepted

## Context
NSE bhavcopy prices, including the previous close, are raw. On a bonus or split ex-date the price halves (or worse) overnight. Without adjustment that day reads as a crash, and every rolling measure built on it is wrong: returns, RSI, moving averages, 52-week range, volume baseline, breadth, screens and alerts.

## Decision
- Keep `daily_bars` raw: it is the source of truth and matches what NSE published.
- Import corporate actions from the daily PR archive (`bc<date>.csv`) into `corporate_actions (symbol, ex_date, ratio)`, where `ratio` = shares after ÷ shares before (bonus 1:1 → 2, split ₹10→₹2 → 5, consolidation ₹1→₹10 → 0.1). Dividends and rights are ignored.
- Adjust inside the indicators query: each bar's prices are divided by the product of ratios with a later ex-date; on the ex-date the previous close is also divided by that day's ratio. Volumes are multiplied.

## Consequences
- A parser fix or a missed action is repaired by recomputing indicators, never by re-downloading history.
- Adjustment costs a lateral lookup per bar inside the nightly query. That is acceptable because indicators are computed once per day and stored (ADR 7).
- Purpose text is free-form. The parser handles the observed patterns (`BONUS a:b`, `FACE VALUE SPLIT … FROM RS x TO RS y`, consolidation) and is unit-tested on them. An unrecognised pattern means an unadjusted day, not a crash.
- Rights issues and large special dividends still cause small distortions.
