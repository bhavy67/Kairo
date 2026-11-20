# Development

How to run, test and deploy Kairo. For what the product does, see the [README](../README.md).

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

Design language: [design.md](design.md). Read [architecture.md](architecture.md) for how the pieces fit and why, and [deploy.md](deploy.md) for hosting (Vercel + Supabase, or Docker).

## Scripts

| Command | |
|---|---|
| `pnpm dev` | API on :4000, web on :3000 |
| `pnpm test` | Unit and integration tests |
| `pnpm typecheck` | Strict TypeScript across the workspace |
| `pnpm build` | Production builds |
| `pnpm --filter @kairo/api backfill` | Load NSE history (`-- --days 30` for less) |
| `docker compose up --build` | Postgres, API and web containers (reads `.env`) |
