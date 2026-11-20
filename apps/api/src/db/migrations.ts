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
  {
    id: 4,
    name: "indicators, screens and alerts",
    sql: `
      -- One row per stock per computed day. Written once by the nightly job;
      -- the market overview, screens and alerts all read from here.
      create table indicators (
        symbol          text not null,
        date            date not null,
        close           double precision not null,
        prev_close      double precision not null,
        high            double precision not null,
        low             double precision not null,
        volume          double precision not null,
        turnover        double precision not null,
        change_pct      double precision not null,
        ret_5d          double precision,
        ret_21d         double precision,
        ret_63d         double precision,
        sma20           double precision,
        sma50           double precision,
        sma200          double precision,
        sma50_prev      double precision,
        sma200_prev     double precision,
        n50             integer not null,
        n200            integer not null,
        rsi14           double precision,
        avg_vol20       double precision,
        avg_turnover20  double precision,
        hi52            double precision,
        lo52            double precision,
        n52             integer not null,
        primary key (symbol, date)
      );
      create index indicators_date_idx on indicators (date);

      create table screens (
        id         bigserial primary key,
        name       text not null,
        rule       jsonb not null,
        alert      boolean not null default false,
        created_at timestamptz not null default now()
      );

      -- Last matches per alerting screen, to report only new entries.
      create table screen_results (
        screen_id bigint not null references screens on delete cascade,
        date      date not null,
        symbols   text[] not null,
        primary key (screen_id, date)
      );

      create table alerts (
        id         bigserial primary key,
        symbol     text not null,
        kind       text not null check (kind in ('price_above', 'price_below', 'move_pct', 'cross_200dma')),
        threshold  double precision,
        active     boolean not null default true,
        created_at timestamptz not null default now()
      );

      create table alert_events (
        id           bigserial primary key,
        alert_id     bigint references alerts on delete cascade,
        screen_id    bigint references screens on delete cascade,
        date         date not null,
        symbol       text not null,
        message      text not null,
        delivered_at timestamptz,
        created_at   timestamptz not null default now(),
        check (num_nonnulls(alert_id, screen_id) = 1)
      );
      -- Re-running a day must not duplicate events (or notifications).
      create unique index alert_events_once on alert_events (coalesce(alert_id, 0), coalesce(screen_id, 0), date, symbol);
      create index alert_events_pending on alert_events (created_at) where delivered_at is null;
    `,
  },
  {
    id: 5,
    name: "corporate actions and weekend sessions",
    sql: `
      -- Bonus, split and consolidation ratios from NSE's PR archive. daily_bars
      -- stays raw; indicators divide earlier prices by the cumulative ratio.
      create table corporate_actions (
        symbol  text not null,
        ex_date date not null,
        purpose text not null,
        ratio   double precision not null check (ratio > 0),
        primary key (symbol, ex_date)
      );

      -- Weekends used to be skipped without asking NSE, which missed special
      -- sessions (e.g. Diwali Muhurat trading on a Sunday). Re-check them once.
      delete from ingest_runs where error = 'weekend';
      -- Indicators computed before adjustment existed are stale.
      delete from indicators;
      delete from market_snapshots;
    `,
  },
  {
    id: 6,
    name: "keep raw corporate actions",
    sql: `
      -- Store every action with its raw purpose; ratio is derived (null when the
      -- action does not change the share count or is not understood) and
      -- re-derived by the job, so parser fixes apply to history without re-downloading.
      alter table corporate_actions alter column ratio drop not null;
      alter table corporate_actions drop constraint corporate_actions_ratio_check;
      alter table corporate_actions add constraint corporate_actions_ratio_check check (ratio is null or ratio > 0);
      -- Earlier imports discarded unparsed rows: fetch the PR files once more.
      delete from ingest_runs where source = 'nse_ca';
      delete from indicators;
      delete from market_snapshots;
    `,
  },
  {
    id: 7,
    name: "trades",
    sql: `
      -- Imported tradebook rows. The unique key makes re-importing an overlapping
      -- export a no-op for rows already present.
      create table trades (
        id          bigserial primary key,
        trade_id    text not null,
        order_id    text,
        exchange    text not null,
        symbol      text not null,
        isin        text not null,
        trade_date  date not null,
        side        text not null check (side in ('buy', 'sell')),
        quantity    double precision not null check (quantity > 0),
        price       double precision not null check (price >= 0),
        -- Local exchange time as exported (IST, no zone); used only to order same-day trades.
        executed_at text,
        imported_at timestamptz not null default now(),
        unique (exchange, trade_date, symbol, trade_id)
      );
      create index trades_date_idx on trades (trade_date);

      create table trade_imports (
        id         bigserial primary key,
        filename   text,
        rows       integer not null,
        inserted   integer not null,
        skipped    integer not null,
        created_at timestamptz not null default now()
      );
    `,
  },
  {
    id: 8,
    name: "global series",
    sql: `
      -- End-of-day global series (indices, US 10-year, Brent, rupee rates).
      create table global_series (
        id    text not null,
        date  date not null,
        value double precision not null,
        primary key (id, date)
      );
      -- Market data, so the public demo's read-only role may read it (when that role exists).
      do $$ begin
        if exists (select 1 from pg_roles where rolname = 'kairo_demo') then
          execute 'grant select on global_series to kairo_demo';
        end if;
      end $$;
    `,
  },
  {
    id: 9,
    name: "long sessions and holdings snapshots",
    sql: `
      -- The Kairo session (30 days, sliding) and the Kite token (daily) now have
      -- separate lifetimes; the token is optional and may be absent.
      alter table sessions alter column token_enc drop not null;
      alter table sessions add column kite_expires_at timestamptz;
      alter table sessions add column last_seen_at timestamptz not null default now();
      update sessions set kite_expires_at = expires_at;
      create index sessions_user_idx on sessions (user_id);

      -- Last holdings fetched from the broker, served (revalued at the latest NSE
      -- close and AMFI NAV) when the Kite token has expired. Personal: not granted
      -- to the demo role.
      create table holdings_snapshots (
        user_id  text primary key,
        payload  jsonb not null,
        taken_at timestamptz not null default now()
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
