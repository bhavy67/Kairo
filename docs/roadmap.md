# Roadmap

Data plan: start on free sources; move to Kite Connect (₹500/month) for live ticks and historical candles once Phase 2 works.

Hosting: Vercel (Mumbai) + Supabase. See [deploy.md](deploy.md).

## Phase 1: Portfolio (done)
- [x] Kite OAuth login, single allowed user, daily expiry
- [x] Holdings, mutual funds, cash, allocation
- [x] Demo mode, tests, CI, Docker
- [ ] Positions view (endpoint exists)
- [x] Tradebook CSV import → XIRR, realised P&L by FY, reconciliation (Phase 4.5)

## Phase 2: Indian markets (done, end-of-day)
- [x] Postgres with migrations; PGlite for dev and tests
- [x] Daily NSE archive import, self-healing scheduler, backfill CLI, import log
- [x] Indices with 60-session trend, India VIX
- [x] Breadth: advances/declines, % of Nifty 500 above 50/200-day average, 52-week highs/lows
- [x] Sector heatmap, top gainers/losers, volume spikes
- [x] Sector allocation of holdings
- [x] Watchlist
- [x] Corporate-action adjustment for price history (Phase 4)
- [ ] Breadth history chart (A/D line, % above 200-day over time)
- [ ] Intraday quotes once on the Kite data plan

## Phase 3: Global
- [ ] US/EU/Asia indices, USD/INR, US 10Y, Brent (Finnhub or Twelve Data free tier)
- [ ] Overnight-cues summary before the Indian open

## Phase 4: Signals and screeners (done)
- [x] Daily indicators: 20/50/200-day averages, RSI 14, 1W/1M/3M returns, volume ratio, 52-week range, crossovers
- [x] Corporate-action adjustment; weekend special sessions
- [x] "Stocks of the day": six rule-based presets with reasons
- [x] Screen builder, saved screens
- [x] Alerts: price crosses, big moves, 200-day crosses, new screen entrants; Telegram digest
- [ ] MACD, ATR-based volatility filters
- [ ] Indicators for holdings outside the Nifty 500
- [ ] Email channel

## Phase 5: Orders
- [ ] VPS with a static IP registered with Zerodha (required for API orders under SEBI's retail algo rules)
- [ ] Order ticket with explicit confirmation, client-side idempotency key, audit log
- [ ] Per-order and daily value limits

## Phase 6: Experiments
- [ ] Backtest saved screeners on stored data
- [ ] News summaries per holding
