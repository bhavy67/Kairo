# Deploying

Kairo runs in two shapes from the same code.

| | Vercel (current) | Docker / VPS |
|---|---|---|
| `/api` | `apps/web/src/pages/api/[...path].ts` hands Node req/res to Fastify in-process | Next.js proxies to the API container (`API_URL`) |
| Daily NSE import | Vercel Cron → `GET /api/cron/eod` (19:00 IST, Mon–Fri) | In-process scheduler, every 15 min |
| Database | Supabase Postgres via the pooler | Postgres container |
| Kite orders (Phase 5) | Not possible: no static IP | Possible with a registered static IP |

## Vercel

Project `kairo` (root directory `apps/web`, region `bom1` Mumbai), deployed on every push to `main`. Production domain: https://kairo.bhavyladani.in. Redirects after login are relative, so any domain works without configuration. Settings live in `apps/web/vercel.json`.

### Environment variables

| Key | Notes |
|---|---|
| `DATABASE_URL` | Supabase **pooler**, transaction mode, port 6543, user `kairo_app.<project-ref>`. Vercel functions have no IPv6, and Supabase's direct host is IPv6-only. |
| `DATABASE_CA_CERT` | Optional. Supabase CA (PEM, from Database → Settings → SSL). When set, the server certificate is verified; otherwise `sslmode=no-verify` gives encryption without verification. |
| `SESSION_SECRET` | 32+ random bytes. Signs cookies and encrypts Kite tokens at rest. Rotating it signs everyone out. |
| `CRON_SECRET` | Vercel Cron sends it as a bearer token. |
| `DATA_MODE` | `demo` (public, read-only) or `kite`. |
| `KITE_API_KEY`, `KITE_API_SECRET`, `KITE_ALLOWED_USER_ID` | Only for `DATA_MODE=kite`. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Optional. Alert digest after each import. Create a bot with @BotFather, message it once, then read your chat id from `https://api.telegram.org/bot<token>/getUpdates`. |

### Database

- App role `kairo_app` owns a private schema `kairo` and has `search_path = kairo`. Kairo's tables are **not** in `public`, so Supabase's auto-generated REST API (reachable with the public anon key) cannot see them, sessions included.
- Migrations run automatically on cold start (`schema_migrations` makes them no-ops after the first).

### Seeding history

The cron route fills at most `limit` trading days per call to fit the 60 s function budget. To load a year:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://kairo.bhavyladani.in/api/cron/eod?days=400&limit=20"
```

Repeat until the response says `"more": false`.

### Switching to your Kite account

1. Create a Personal app at developers.kite.trade (or rotate the secret of the existing one).
2. Redirect URL: `https://kairo.bhavyladani.in/api/auth/callback`.
3. In Vercel → Settings → Environment Variables add `KITE_API_KEY`, `KITE_API_SECRET` (sensitive), `KITE_ALLOWED_USER_ID`, and set `DATA_MODE=kite`.
4. Redeploy.

## Docker / VPS

```bash
cp .env.example .env   # fill in
docker compose up --build -d
```

The API container runs the scheduler. Put a TLS-terminating reverse proxy (Caddy, nginx) in front of port 3000.
