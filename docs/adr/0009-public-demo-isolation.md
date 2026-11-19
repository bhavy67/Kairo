# 9. Public demo with a read-only database role

**Status:** accepted

## Context
The private deployment (kairo.bhavyladani.in) runs in Kite mode behind a login. A public demo is needed for people without the owner's Zerodha account. It should show real market data without any path to personal data (sessions, watchlist, alerts, screens, trades).

## Decision
- A second Vercel project (`kairo-demo`, kairo-demo.bhavyladani.in) from the same repo, `DATA_MODE=demo`, `DATABASE_READ_ONLY=true`.
- It connects as `kairo_demo`, a Postgres role with `SELECT` on market tables only and `default_transaction_read_only = on`. Personal tables are not granted, so they are unreadable at the database level, not merely hidden by the app.
- In read-only mode the app skips migrations, never touches the sessions table, serves the newest stored market snapshot instead of computing one, and returns empty personal lists. Returns shows a fixed sample tradebook.

## Consequences
- Defence in depth: an app bug cannot leak personal rows, because the role cannot read them.
- New market tables need an explicit `grant select … to kairo_demo`; new personal tables need nothing.
- The demo depends on the private deployment's cron for fresh data (they share the database). The cron route is not registered on the demo (no `CRON_SECRET`), so its scheduled call returns 404.
