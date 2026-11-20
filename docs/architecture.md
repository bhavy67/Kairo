# Architecture

## Shape

```
Browser ──► Next.js (web, :3000) ──/api/* rewrite──► Fastify (api, :4000) ──► Kite Connect
                                                          │                ──► AMFI NAV file
                                                          ├─ in-memory sessions
                                                          ├─ Postgres (PGlite in dev/tests)
                                                          └─ EOD scheduler ──► NSE archive
```

The browser only talks to the web origin. Next.js rewrites `/api/*` to the API, so the session cookie is first-party and no CORS is involved.

## Layers

**`@kairo/core`** holds domain types (`Holding`, `FundHolding`, …) and pure functions: valuation, summary, XIRR, AMFI parsing. It has no I/O and no vendor field names, so it is cheap to test and the rules live in one place.

**Providers** (`apps/api/src/providers`) implement `PortfolioProvider`. `kiteProvider` maps Kite payloads into core types; `demoProvider` returns a fixed portfolio. Routes depend on the interface only. A second broker, or a recorded-fixture provider for tests, is a new file and not a route change.

**Kite client** (`apps/api/src/kite`) is a small typed wrapper over Kite Connect v3 REST using `fetch`. Every response is validated with Zod at the boundary: unknown fields are dropped, and a changed or missing field fails as a 502 with a clear message instead of rendering `NaN`.

## Auth and sessions

1. `GET /api/auth/login` sets a signed, short-lived `state` cookie and redirects to Kite with `redirect_params=state=…`.
2. Kite redirects to `/api/auth/callback?request_token=…&state=…`.
3. The API checks `state` (constant-time compare), exchanges the token using `sha256(api_key + request_token + api_secret)`, and rejects any user other than `KITE_ALLOWED_USER_ID`. It revokes that user's token rather than leaving it live.
4. A random session id goes into a signed, `HttpOnly`, `SameSite=Lax` cookie. The Kite access token stays on the server.
5. The Kairo session lasts 30 days and slides while used; the Kite token expires daily around 06:00 IST and is held separately. Without a working token, the portfolio is served from the last saved snapshot, revalued at the latest NSE close and AMFI NAV, and the UI offers "Reconnect Kite". See ADR 11.

The secret and the access token never reach the browser. Logs redact `authorization`, `cookie` and `set-cookie`.

## Data freshness

- `/api/portfolio` fetches holdings, funds and cash in parallel and returns one snapshot, so totals and tables always agree.
- The web app polls every 30 s during NSE hours (09:15–15:30 IST, Mon–Fri) and every 10 min otherwise. Exchange holidays are not modelled yet.
- AMFI NAVs are cached in memory for 6 hours, with single-flight refresh. A failed refresh keeps serving the last good copy.

## Market data pipeline (Phase 2)

```
NSE archive ──► NseArchive (fetch, unzip, retry) ──► core parsers ──► ingestDay (one tx) ──► Postgres
                                                                                               │
/api/market/overview ◄── marketStats (pure TS) ◄── window-function SQL (one query) ◄───────────┘
```

**Tables:** `instruments` (Nifty 500, with industry), `index_members`, `daily_bars` (every EQ/BE stock, every day), `index_bars`, `ingest_runs`, `watchlist_items`. Schema lives in `apps/api/src/db/migrations.ts`.

**Ingestion** is idempotent per day: rows are upserted with `unnest` (one round trip per file) and the day is recorded in `ingest_runs` inside the same transaction. A scheduler tick every 15 minutes fills any missing day in the last 10, so restarts and missed evenings heal themselves. A 404 for a past weekday is recorded as a holiday; a 404 for *today* is left unrecorded so it is retried once NSE publishes.

**Analytics** run as one SQL statement over ~400 days of the Nifty 500 with named windows (`prev20`, `last50`, `last200`, `prev250`) producing each stock's volume baseline, SMAs and 52-week range. The pure `marketStats` function in core turns those rows into breadth, sectors and movers, so the rules are unit tested without a database. Stocks without enough history are excluded from SMA breadth rather than counted as below.

## Signals pipeline (Phase 4)

```
import day ─► corporate actions ─► computeIndicators (adjusted, one SQL statement) ─► indicators
                                                                                         │
             market_snapshots ◄── marketStats ◄────────────────────────────────────────┤
             /api/screens/*   ◄── runScreen (core, pure) ◄─────────────────────────────┤
             alert_events ──► Telegram digest ◄── evaluateAlerts / newMatches ◄─────────┘
```

- **Indicators** are computed once per trading day for the Nifty 500 plus watchlist and alert symbols, with corporate-action adjustment (ADR 6), and stored (ADR 7).
- **Screens** are JSON rules validated against a field whitelist and evaluated in TypeScript. "Stocks of the day" are six preset rules, each with a plain-language reason.
- **Alerts**: price crosses, big moves, 200-day crosses, and new entrants to saved screens. They are evaluated after each import. Events are idempotent per day, and one Telegram digest goes out per run.

## Returns from the tradebook (ADR 8)

```
Console CSV ─► parseTradebook ─► trades (unique per exchange/date/symbol/trade id)
                                   │
ISIN → NSE symbol ─► matchLots (corporate actions → intraday netting → FIFO) ─► summarizeTrades
                                                                                  │  + Kite holdings (prices, quantities)
                                                        XIRR · realised by FY · unrealised · reconciliation
```

## Global markets

`runGlobalJob` refreshes ten series into `global_series (id, date, value)`: FRED CSVs for US indices, Nikkei, the US 10-year yield and Brent, and one Frankfurter call for rupee rates. Each source fails independently, the first run loads 400 days, and later runs re-read a 10-day overlap because sources revise late prints. On Vercel, FRED requests go through a Supabase Edge Function relay because FRED blocks Vercel's Mumbai region (ADR 10). It runs from the morning cron (08:10 IST, Tue–Sat, after the US close) and after the evening NSE import. `overnightCues` turns the latest quotes into one descriptive sentence; only equity indices get gain/loss colour, since a rising yield, oil price or dollar is not simply good or bad.

## Deployments (ADR 9)

| | kairo.bhavyladani.in | kairo-demo.bhavyladani.in |
|---|---|---|
| Mode | Kite, behind login | Demo portfolio, sample tradebook |
| DB role | `kairo_app` (owner) | `kairo_demo` (SELECT on market tables, read-only transactions) |
| Cron | Imports NSE data, computes indicators, sends alerts | None |

## Known limits (deliberate for now)

| Limit | Why it is acceptable now | When it changes |
|---|---|---|
| End-of-day market data only | Free; see ADR 4 | Kite Connect data plan |
| Corporate actions parsed from free text | Covers bonus, split, consolidation | Kite historical candles (pre-adjusted) |
| Scheduler in the API process | One instance | Advisory lock or separate worker |
| No XIRR for equity | Kite's API has no historical trades; average price has no dates | Tradebook CSV import from Console |
| Sectors only for Nifty 500 stocks | NSE publishes industry per index list | Add more constituent lists |
