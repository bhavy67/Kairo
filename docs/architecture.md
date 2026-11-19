# Architecture

## Shape

```
Browser ──► Next.js (web, :3000) ──/api/* rewrite──► Fastify (api, :4000) ──► Kite Connect
                                                          │                ──► AMFI NAV file
                                                          └─ in-memory sessions
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
5. Sessions expire at 00:30 UTC (06:00 IST), the moment Kite invalidates tokens. If Kite rejects a token early (`TokenException`), the session is dropped and the UI routes to login.

The secret and the access token never reach the browser. Logs redact `authorization`, `cookie` and `set-cookie`.

## Data freshness

- `/api/portfolio` fetches holdings, funds and cash in parallel and returns one snapshot, so totals and tables always agree.
- The web app polls every 30 s during NSE hours (09:15–15:30 IST, Mon–Fri) and every 10 min otherwise. Exchange holidays are not modelled yet.
- AMFI NAVs are cached in memory for 6 hours, with single-flight refresh. A failed refresh keeps serving the last good copy.

## Known limits (deliberate for now)

| Limit | Why it is acceptable now | When it changes |
|---|---|---|
| In-memory sessions | One user, one process; a restart costs one login | Multiple instances, or Phase 5 (orders) |
| No database | Phase 1 reads live broker state only | Phase 2: daily candles, watchlists, screeners |
| No XIRR for equity | Kite's API has no historical trades; average price has no dates | Tradebook CSV import from Console |
| No sector allocation | Kite holdings carry no sector | Phase 2: NSE index constituent files |
