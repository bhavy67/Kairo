import { actionRatio, parseBhavcopy, parseConstituents, parseCorporateActions, parseIndexClose, type DailyBar, type IndexBar } from "@kairo/core";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/db.js";
import { addDays, EOD_READY_MINUTES, istDate, istMinutes, isWeekend } from "./calendar.js";
import type { NseArchive } from "./nse-archive.js";

export const SOURCE = "nse_eod";
export const CA_SOURCE = "nse_ca";

export type DayResult = { date: string; status: "ok" | "skipped" | "failed" | "pending"; rows: number; error?: string };

/**
 * Bulk upsert with unnest: one round trip for ~2,800 rows instead of 2,800 INSERTs.
 * ON CONFLICT makes re-running a day harmless (NSE occasionally republishes a file).
 */
async function upsertBars(db: Db, bars: DailyBar[]): Promise<void> {
  if (bars.length === 0) return;
  const col = <K extends keyof DailyBar>(k: K) => bars.map((b) => b[k]);
  await db.query(
    `insert into daily_bars (symbol, date, isin, open, high, low, close, prev_close, volume, turnover)
     select * from unnest($1::text[], $2::date[], $3::text[], $4::float8[], $5::float8[], $6::float8[],
                          $7::float8[], $8::float8[], $9::bigint[], $10::float8[])
     on conflict (symbol, date) do update set
       isin = excluded.isin, open = excluded.open, high = excluded.high, low = excluded.low,
       close = excluded.close, prev_close = excluded.prev_close, volume = excluded.volume,
       turnover = excluded.turnover`,
    [col("symbol"), col("date"), col("isin"), col("open"), col("high"), col("low"), col("close"), col("prevClose"), col("volume").map(Math.round), col("turnover")],
  );
}

async function upsertIndexBars(db: Db, bars: IndexBar[]): Promise<void> {
  if (bars.length === 0) return;
  const col = <K extends keyof IndexBar>(k: K) => bars.map((b) => b[k]);
  await db.query(
    `insert into index_bars (name, date, open, high, low, close, change_pct, pe, pb)
     select * from unnest($1::text[], $2::date[], $3::float8[], $4::float8[], $5::float8[],
                          $6::float8[], $7::float8[], $8::float8[], $9::float8[])
     on conflict (name, date) do update set
       open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close,
       change_pct = excluded.change_pct, pe = excluded.pe, pb = excluded.pb`,
    [col("name"), col("date"), col("open"), col("high"), col("low"), col("close"), col("changePct"), col("pe"), col("pb")],
  );
}

async function recordRun(db: Db, date: string, status: "ok" | "skipped" | "failed", rows: number, error?: string, source = SOURCE) {
  await db.query(
    `insert into ingest_runs (source, date, status, rows, error, finished_at) values ($1, $2, $3, $4, $5, now())
     on conflict (source, date) do update set status = excluded.status, rows = excluded.rows,
       error = excluded.error, finished_at = excluded.finished_at`,
    [source, date, status, rows, error ?? null],
  );
}

/**
 * Re-derive every stored ratio from its raw purpose with the current parser.
 * A few hundred rows a year, so it simply runs on every job. Returns how many changed;
 * any change makes stored indicators stale, which the caller handles.
 */
export async function reparseCorporateActions(db: Db): Promise<number> {
  const rows = await db.query<{ symbol: string; ex_date: string; purpose: string; ratio: number | null }>(
    "select symbol, ex_date::text as ex_date, purpose, ratio from corporate_actions",
  );
  // Compare with a tolerance: some servers return float8 as 15-digit text, so a
  // 1:3 bonus (4/3) never round-trips exactly, and an exact compare would reset
  // every indicator on every run.
  const same = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)));
  const changed = rows.filter((r) => !same(actionRatio(r.purpose), r.ratio));
  if (changed.length === 0) return 0;
  await db.query(
    `update corporate_actions c set ratio = u.ratio
     from unnest($1::text[], $2::date[], $3::float8[]) as u(symbol, ex_date, ratio)
     where c.symbol = u.symbol and c.ex_date = u.ex_date`,
    [changed.map((r) => r.symbol), changed.map((r) => r.ex_date), changed.map((r) => actionRatio(r.purpose))],
  );
  return changed.length;
}

/**
 * Corporate actions for a day that has bars. Separate source in ingest_runs so
 * it can be backfilled for history imported before adjustment existed.
 */
export async function ingestCorporateActions(db: Db, nse: NseArchive, date: string): Promise<DayResult> {
  try {
    const csv = await nse.corporateActions(date);
    const actions = csv ? parseCorporateActions(csv) : [];
    await db.tx(async (tx) => {
      if (actions.length) {
        await tx.query(
          `insert into corporate_actions (symbol, ex_date, purpose, ratio)
           select * from unnest($1::text[], $2::date[], $3::text[], $4::float8[])
           on conflict (symbol, ex_date) do update set purpose = excluded.purpose, ratio = excluded.ratio`,
          [actions.map((a) => a.symbol), actions.map((a) => a.exDate), actions.map((a) => a.purpose), actions.map((a) => a.ratio)],
        );
      }
      await recordRun(tx, date, csv === null ? "skipped" : "ok", actions.length, csv === null ? "no PR file" : undefined, CA_SOURCE);
    });
    return { date, status: csv === null ? "skipped" : "ok", rows: actions.length };
  } catch (err) {
    const error = (err as Error).message;
    await recordRun(db, date, "failed", 0, error, CA_SOURCE);
    return { date, status: "failed", rows: 0, error };
  }
}

/**
 * Ingest one trading day. A 404 for a past date is recorded as a holiday;
 * a 404 for today is "pending" and NOT recorded, so the next tick retries it.
 * (Recording it would mark a normal trading day as a holiday forever.)
 */
export async function ingestDay(db: Db, nse: NseArchive, date: string, now: number = Date.now()): Promise<DayResult> {
  // Weekends are fetched too: NSE holds occasional special sessions (Diwali Muhurat
  // trading falls on a weekend some years). A 404 is cheap and recorded once.
  try {
    const [bhav, indices] = await Promise.all([nse.bhavcopy(date), nse.indexClose(date)]);
    if (!bhav) {
      const isToday = date >= istDate(now);
      if (isToday) return { date, status: "pending", rows: 0 };
      await recordRun(db, date, "skipped", 0, isWeekend(date) ? "no session" : "no bhavcopy (holiday)");
      return { date, status: "skipped", rows: 0 };
    }
    const bars = parseBhavcopy(bhav);
    const idx = indices ? parseIndexClose(indices) : [];
    await db.tx(async (tx) => {
      await upsertBars(tx, bars);
      await upsertIndexBars(tx, idx);
      await recordRun(tx, date, "ok", bars.length);
    });
    return { date, status: "ok", rows: bars.length };
  } catch (err) {
    const error = (err as Error).message;
    await recordRun(db, date, "failed", 0, error);
    return { date, status: "failed", rows: 0, error };
  }
}

/** Refresh the Nifty 500 / Nifty 50 lists and industries. Weekly is plenty. */
export async function refreshConstituents(db: Db, nse: NseArchive): Promise<number> {
  const [n500, n50] = await Promise.all([nse.constituents("nifty500"), nse.constituents("nifty50")]);
  const all = parseConstituents(n500);
  const top = parseConstituents(n50);
  await db.tx(async (tx) => {
    await tx.query(
      `insert into instruments (symbol, isin, name, industry, updated_at)
       select *, now() from unnest($1::text[], $2::text[], $3::text[], $4::text[])
       on conflict (symbol) do update set isin = excluded.isin, name = excluded.name,
         industry = excluded.industry, updated_at = now()`,
      [all.map((i) => i.symbol), all.map((i) => i.isin), all.map((i) => i.name), all.map((i) => i.industry)],
    );
    for (const [index, list] of [["NIFTY 500", all], ["NIFTY 50", top]] as const) {
      await tx.query("delete from index_members where index_name = $1", [index]);
      await tx.query("insert into index_members (index_name, symbol) select $1, unnest($2::text[])", [index, list.map((i) => i.symbol)]);
    }
  });
  return all.length;
}

/** Dates in [from, to] (inclusive) with no ok/skipped run, newest first. */
async function missingDates(db: Db, from: string, to: string, source = SOURCE): Promise<string[]> {
  const done = new Set(
    (
      await db.query<{ date: string }>(
        `select date::text as date from ingest_runs where source = $1 and status in ('ok', 'skipped') and date between $2 and $3`,
        [source, from, to],
      )
    ).map((r) => r.date),
  );
  const out: string[] = [];
  for (let d = to; d >= from; d = addDays(d, -1)) if (!done.has(d)) out.push(d);
  return out;
}

export interface BackfillOptions {
  days: number;
  /** Stop after this many trading-day attempts (serverless time budget). Newest first. */
  limit?: number;
  now?: number;
  delayMs?: number;
  log?: Pick<FastifyBaseLogger, "info" | "warn">;
}

/**
 * Fill every missing day in the last `days` calendar days. Sequential with a
 * pause between days: the archive is a shared public service, not ours.
 */
export async function backfill(db: Db, nse: NseArchive, { days, limit = Infinity, now = Date.now(), delayMs = 400, log }: BackfillOptions): Promise<DayResult[]> {
  // Today only counts once the file should exist.
  const today = istDate(now);
  const to = istMinutes(now) >= EOD_READY_MINUTES ? today : addDays(today, -1);
  const dates = await missingDates(db, addDays(to, -(days - 1)), to);
  const results: DayResult[] = [];
  let attempts = 0;
  for (const date of dates) {
    if (attempts++ >= limit) break;
    const r = await ingestDay(db, nse, date, now);
    results.push(r);
    if (r.status === "failed") log?.warn({ date, error: r.error }, "eod ingest failed");
    else if (r.status === "ok") log?.info({ date, rows: r.rows }, "eod ingested");
    if (delayMs > 0) await new Promise((res) => setTimeout(res, delayMs));
  }

  // Corporate actions for trading days that have bars but no CA run yet (also heals old history).
  const caBudget = Math.max(0, limit - attempts);
  if (caBudget > 0) {
    const tradingDays = new Set(
      (
        await db.query<{ date: string }>(
          `select date::text as date from ingest_runs where source = $1 and status = 'ok' and date between $2 and $3`,
          [SOURCE, addDays(to, -(days - 1)), to],
        )
      ).map((r) => r.date),
    );
    const caMissing = (await missingDates(db, addDays(to, -(days - 1)), to, CA_SOURCE)).filter((d) => tradingDays.has(d));
    for (const date of caMissing.slice(0, caBudget)) {
      const r = await ingestCorporateActions(db, nse, date);
      if (r.status === "failed") log?.warn({ date, error: r.error }, "corporate actions failed");
      results.push({ ...r, date: `${date} (ca)` });
      if (delayMs > 0) await new Promise((res) => setTimeout(res, delayMs));
    }
  }
  return results;
}

export interface EodJobResult {
  constituentsRefreshed: boolean;
  /** Corporate-action ratios changed by the current parser (indicators were reset). */
  reparsed: number;
  results: DayResult[];
  /** True when the time budget ran out before every missing day was filled. */
  more: boolean;
}

/**
 * The daily job, shared by the in-process scheduler and the HTTP cron route:
 * refresh constituents when a week old, then fill missing days, newest first.
 */
export async function runEodJob(
  db: Db,
  nse: NseArchive,
  { days = 10, limit = Infinity, now = Date.now(), delayMs = 400, log }: Partial<BackfillOptions> = {},
): Promise<EodJobResult> {
  const [row] = await db.query<{ stale: boolean }>(
    "select coalesce(max(updated_at) < now() - interval '7 days', true) as stale from instruments",
  );
  const constituentsRefreshed = row?.stale ?? true;
  if (constituentsRefreshed) await refreshConstituents(db, nse);
  const results = await backfill(db, nse, { days, limit, now, delayMs, ...(log ? { log } : {}) });
  const reparsed = await reparseCorporateActions(db);
  if (reparsed > 0) {
    // Adjustment changed: every stored indicator row and snapshot may be wrong.
    await db.query("delete from indicators");
    await db.query("delete from market_snapshots");
  }
  return { constituentsRefreshed, results, reparsed, more: results.length >= limit };
}
