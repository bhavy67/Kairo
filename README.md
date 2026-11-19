# Kairo

A personal market desk for an Indian retail investor: portfolio, markets and signals in one quiet dashboard, backed by Zerodha Kite.

*Kairos*: the right moment.

![status](https://img.shields.io/badge/phase-4%20·%20signals-0b0b0b)

Live demo: https://kairo-demo.bhavyladani.in (demo portfolio and sample tradebook, real NSE end-of-day data). The owner's instance at kairo.bhavyladani.in is private.

## What it does today

- **Overview**: total value, invested, P&L, today's change, allocation across equity, mutual funds and cash.
- **Holdings**: equity holdings with average cost, LTP, P&L, day change and weight. Sortable.
- **Funds**: Coin mutual fund holdings with NAV, P&L and weight.
- **Markets** (NSE end of day): headline indices with trend, India VIX, breadth across the Nifty 500, sector heatmap, top movers and volume spikes.
- **Global**: S&P 500, Nasdaq, Dow, Nikkei, US 10-year yield, Brent and rupee rates, with an overnight-cues summary for the Indian open.
- **Returns** from your Zerodha tradebook: XIRR per stock and overall, realised P&L by financial year (short-term, long-term, intraday), FIFO lots with bonus and split handling, and reconciliation against broker holdings.
- **Screener**: "stocks of the day" from six rule-based presets (breakouts, momentum, pullbacks, 200-day reclaims, unusual volume, oversold large caps), a rule builder, and saved screens.
- **Alerts**: price crosses, big moves, 200-day crosses and new screen entrants, evaluated after each NSE close, with an optional Telegram digest.
- **Watchlist** of NSE symbols with RSI, trend and 3-month return.
- **Sector allocation** of your equity holdings.
- **Kite login** with a CSRF-protected OAuth flow, restricted to one Kite account.
- **Demo mode**: runs with a fake portfolio and no broker account, so anyone can clone and try it.

Order placement is next. See the [roadmap](docs/roadmap.md).

## Quick start (demo mode)

```bash
pnpm install
pnpm --filter @kairo/core build
pnpm dev
```

Open http://localhost:3000. No `.env` and no database server needed: the API uses an embedded Postgres (PGlite) in `apps/api/.data`.

Load market history once (about 5 minutes, ~270 sessions from the NSE archive):

```bash
pnpm --filter @kairo/api backfill
```

After that the API imports each new trading day by itself after 18:30 IST.

## Run against your Kite account

1. Create a **Personal** app at [developers.kite.trade](https://developers.kite.trade). It is free and covers holdings, positions, funds and orders.
2. Set its redirect URL to `http://localhost:3000/api/auth/callback`.
3. `cp .env.example .env`, set `DATA_MODE=kite` and fill in the Kite keys, your client ID and a session secret.
4. `pnpm dev`, then sign in with Kite.

Kite expires every access token around 06:00 IST, so expect to sign in once a day. That is a broker rule, not a bug.

## Stack

| Layer | Choice |
|---|---|
| Web | Next.js (App Router), React, TanStack Query |
| API | Fastify, Zod, Node 22 |
| Data | Postgres (PGlite in dev/tests), NSE end-of-day archive |
| Domain | `@kairo/core`: pure TypeScript, broker-agnostic, unit tested |
| Tooling | pnpm workspaces, Vitest, GitHub Actions, Docker |

```
apps/web       Next.js dashboard; proxies /api to the API
apps/api       Fastify server: Kite adapter, sessions, NSE import, market SQL
packages/core  Domain types, portfolio math, NSE/AMFI parsers, market stats
docs/          Architecture, decision records, roadmap
```

Design language: [docs/design.md](docs/design.md). Read [docs/architecture.md](docs/architecture.md) for how the pieces fit and why, and [docs/deploy.md](docs/deploy.md) for hosting (Vercel + Supabase, or Docker).

## Scripts

| Command | |
|---|---|
| `pnpm dev` | API on :4000, web on :3000 |
| `pnpm test` | Unit and integration tests |
| `pnpm typecheck` | Strict TypeScript across the workspace |
| `pnpm build` | Production builds |
| `pnpm --filter @kairo/api backfill` | Load NSE history (`-- --days 30` for less) |
| `docker compose up --build` | Postgres, API and web containers (reads `.env`) |

## Disclaimer

A personal tool, not investment advice. Indicators and signals describe what prices did, not what they will do.
