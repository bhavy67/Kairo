# 4. Market data from NSE's end-of-day archive

**Status:** accepted

## Context
Phase 2 needs indices, breadth, sectors and movers. Budget: free for now. Options:

| Source | Cost | Reliability | Terms |
|---|---|---|---|
| Kite Connect data APIs | ₹500/month | High, official | Fine |
| nseindia.com JSON endpoints | Free | Cookie dance, blocks servers | Scraping, discouraged |
| Yahoo Finance unofficial API | Free | Rate-limited (429 from cloud IPs in testing) | Unofficial |
| NSE archive files (bhavcopy, index closes, constituent lists) | Free | Static files, published daily | Public downloads |

## Decision
Use the NSE archive: one bhavcopy, one index-close file per trading day, constituent lists weekly. Store history in Postgres and compute everything with SQL window functions.

## Consequences
- End-of-day only. The Markets page says "NSE close · <date>" so nobody mistakes it for live data.
- No market cap in the files, so sector moves are equal-weighted (labelled as such).
- Bhavcopy prices are **not adjusted** for splits and bonuses. Day change is correct (NSE adjusts the previous close), but moving averages and 52-week ranges for a stock that just split are wrong until enough new history accumulates. Fix: a corporate-actions table, or Kite historical candles once paid.
- Moving to Kite's ₹500 plan later adds intraday ticks; the stored EOD history stays useful for screeners and backtests.
