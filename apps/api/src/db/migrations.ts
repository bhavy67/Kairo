import type { Db } from "./db.js";

/**
 * Forward-only migrations, embedded so the build ships no loose .sql files.
 * Never edit a migration that has run anywhere; add a new one.
 */
const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: "market data",
    sql: `
      create table instruments (
        symbol     text primary key,
        isin       text not null,
        name       text not null,
        industry   text not null,
        updated_at timestamptz not null default now()
      );
      create index instruments_isin_idx on instruments (isin);

      create table index_members (
        index_name text not null,
        symbol     text not null,
        primary key (index_name, symbol)
      );

      -- One row per stock per trading day. The PK (symbol, date) also serves
      -- per-symbol range scans for moving averages; the date index serves
      -- "everything on day D".
      create table daily_bars (
        symbol     text not null,
        date       date not null,
        isin       text not null,
        open       double precision not null,
        high       double precision not null,
        low        double precision not null,
        close      double precision not null,
        prev_close double precision not null,
        volume     bigint not null,
        turnover   double precision not null,
        primary key (symbol, date)
      );
      create index daily_bars_date_idx on daily_bars (date);

      create table index_bars (
        name       text not null,
        date       date not null,
        open       double precision,
        high       double precision,
        low        double precision,
        close      double precision not null,
        change_pct double precision,
        pe         double precision,
        pb         double precision,
        primary key (name, date)
      );

      -- Audit log and idempotency key for ingestion: one row per source per day.
      create table ingest_runs (
        source      text not null,
        date        date not null,
        status      text not null check (status in ('ok', 'skipped', 'failed')),
        rows        integer not null default 0,
        error       text,
        finished_at timestamptz not null default now(),
        primary key (source, date)
      );

      create table watchlist_items (
        symbol   text primary key,
        note     text,
        added_at timestamptz not null default now()
      );
    `,
  },
  {
    id: 2,
    name: "sessions",
    sql: `
      -- Serverless instances share nothing in memory, so sessions live here.
      -- id_hash = sha256(cookie value): a database leak does not yield usable cookies.
      -- token_enc = AES-256-GCM(Kite access token), key derived from SESSION_SECRET.
      create table sessions (
        id_hash    text primary key,
        user_id    text not null,
        user_name  text not null,
        token_enc  text not null,
        expires_at timestamptz not null,
        created_at timestamptz not null default now()
      );
      create index sessions_expires_idx on sessions (expires_at);
    `,
  },
  {
    id: 3,
    name: "market snapshots",
    sql: `
      -- The market overview for a trading day, computed once after import.
      -- Reads become a primary-key lookup instead of a ~135k-row window scan,
      -- which matters on serverless where no in-memory cache survives.
      create table market_snapshots (
        date        date not null,
        universe    text not null,
        payload     jsonb not null,
        computed_at timestamptz not null default now(),
        primary key (date, universe)
      );
    `,
  },
];

export async function migrate(db: Db): Promise<number[]> {
  await db.exec(`create table if not exists schema_migrations (
    id integer primary key, name text not null, applied_at timestamptz not null default now())`);
  const done = new Set((await db.query<{ id: number }>("select id from schema_migrations")).map((r) => r.id));
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.tx(async (tx) => {
      await tx.exec(m.sql);
      await tx.query("insert into schema_migrations (id, name) values ($1, $2)", [m.id, m.name]);
    });
    applied.push(m.id);
  }
  return applied;
}
