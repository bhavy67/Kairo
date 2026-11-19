# Kairo

A personal market desk for an Indian retail investor: portfolio, markets and signals in one quiet dashboard, backed by Zerodha Kite.

*Kairos*: the right moment.

![status](https://img.shields.io/badge/phase-1%20·%20portfolio-0b0b0b)

## What it does today

- **Overview**: total value, invested, P&L, today's change, allocation across equity, mutual funds and cash.
- **Holdings**: equity holdings with average cost, LTP, P&L, day change and weight. Sortable.
- **Funds**: Coin mutual fund holdings with NAV, P&L and weight.
- **Kite login** with a CSRF-protected OAuth flow, restricted to one Kite account.
- **Demo mode**: runs with a fake portfolio and no broker account, so anyone can clone and try it.

Markets, Global, signals and order placement are next. See the [roadmap](docs/roadmap.md).

## Quick start (demo mode)

```bash
pnpm install
pnpm --filter @kairo/core build
pnpm dev
```

Open http://localhost:3000. No `.env` needed.

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
| Domain | `@kairo/core`: pure TypeScript, broker-agnostic, unit tested |
| Tooling | pnpm workspaces, Vitest, GitHub Actions, Docker |

```
apps/web       Next.js dashboard; proxies /api to the API
apps/api       Fastify server: Kite adapter, sessions, AMFI NAVs
packages/core  Domain types and portfolio math (P&L, XIRR, AMFI parser)
docs/          Architecture, decision records, roadmap
```

Read [docs/architecture.md](docs/architecture.md) for how the pieces fit and why.

## Scripts

| Command | |
|---|---|
| `pnpm dev` | API on :4000, web on :3000 |
| `pnpm test` | Unit and integration tests |
| `pnpm typecheck` | Strict TypeScript across the workspace |
| `pnpm build` | Production builds |
| `docker compose up --build` | API and web containers (reads `.env`) |

## Disclaimer

A personal tool, not investment advice. Indicators and signals describe what prices did, not what they will do.
