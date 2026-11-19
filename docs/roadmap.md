# Roadmap

Data plan: start on free sources; move to Kite Connect (₹500/month) for live ticks and historical candles once Phase 2 works.

## Phase 1: Portfolio (done)
- [x] Kite OAuth login, single allowed user, daily expiry
- [x] Holdings, mutual funds, cash, allocation
- [x] Demo mode, tests, CI, Docker
- [ ] Positions view (endpoint exists)
- [ ] Tradebook CSV import → equity XIRR

## Phase 2: Indian markets
- [ ] Postgres; daily candle store and scheduled EOD jobs
- [ ] Indices, India VIX, top movers, sector heatmap
- [ ] Market breadth: advance/decline, % of Nifty 500 above 50/200 DMA
- [ ] Sector allocation from NSE constituent files
- [ ] Watchlists

## Phase 3: Global
- [ ] US/EU/Asia indices, USD/INR, US 10Y, Brent (Finnhub or Twelve Data free tier)
- [ ] Overnight-cues summary before the Indian open

## Phase 4: Signals and screeners
- [ ] Indicators computed from stored candles (DMA, RSI, MACD, volume vs average)
- [ ] User-defined screener rules; "stocks of the day" = your saved screens
- [ ] Alerts on Telegram/email

## Phase 5: Orders
- [ ] VPS with a static IP registered with Zerodha (required for API orders under SEBI's retail algo rules)
- [ ] Order ticket with explicit confirmation, client-side idempotency key, audit log
- [ ] Per-order and daily value limits

## Phase 6: Experiments
- [ ] Backtest saved screeners on stored data
- [ ] News summaries per holding
