# 5. PGlite for tests and zero-setup development

**Status:** accepted

## Context
Phase 2 adds Postgres. Tests and `pnpm dev` should not require installing or running a database server, but SQLite would mean different SQL from production (window frames, `unnest`, `on conflict`, `make_interval`).

## Decision
A small `Db` interface with two implementations: node-postgres `Pool` for production, and PGlite (Postgres compiled to WASM, in-process) when `DATABASE_URL` is unset. Every test gets a fresh in-memory database with migrations applied.

## Consequences
- Same SQL everywhere; tests exercise the real query planner and constraints.
- PGlite is single-connection: one process per data directory. Fine for dev; production uses a real server (refused at boot otherwise).
- Drivers differ on type parsing, so queries cast explicitly (`date::text`, `bigint::float8`). That is good practice anyway: `pg` turns `date` into a JS `Date` at local midnight, a classic off-by-one-day bug.
