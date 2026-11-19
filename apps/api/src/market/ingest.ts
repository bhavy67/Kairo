import { parseBhavcopy, parseConstituents, parseIndexClose, type DailyBar, type IndexBar } from "@kairo/core";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/db.js";
import { addDays, EOD_READY_MINUTES, istDate, istMinutes, isWeekend } from "./calendar.js";
import type { NseArchive } from "./nse-archive.js";

export const SOURCE = "nse_eod";

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

async function recordRun(db: Db, date: string, status: "ok" | "skipped" | "failed", rows: number, error?: string) {
  await db.query(
    `insert into ingest_runs (source, date, status, rows, error, finished_at) values ($1, $2, $3, $4, $5, now())
     on conflict (source, date) do update set status = excluded.status, rows = excluded.rows,
       error = excluded.error, finished_at = excluded.finished_at`,
    [SOURCE, date, status, rows, error ?? null],
  );
}

/**
 * Ingest one trading day. A 404 for a past date is recorded as a holiday;
 * a 404 for today is "pending" and NOT recorded, so the next tick retries it.
 * (Recording it would mark a normal trading day as a holiday forever.)
 */
export async function ingestDay(db: Db, nse: NseArchive, date: string, now: number = Date.now()): Promise<DayResult> {
  if (isWeekend(date)) {
    await recordRun(db, date, "skipped", 0, "weekend");
    return { date, status: "skipped", rows: 0 };
  }
  try {
    const [bhav, indices] = await Promise.all([nse.bhavcopy(date), nse.indexClose(date)]);
    if (!bhav) {
      const isToday = date >= istDate(now);
      if (isToday) return { date, status: "pending", rows: 0 };
      await recordRun(db, date, "skipped", 0, "no bhavcopy (holiday)");
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
async function missingDates(db: Db, from: string, to: string): Promise<string[]> {
  const done = new Set(
    (
      await db.query<{ date: string }>(
        `select date::text as date from ingest_runs where source = $1 and status in ('ok', 'skipped') and date between $2 and $3`,
        [SOURCE, from, to],
      )
    ).map((r) => r.date),
  );
  const out: string[] = [];
  for (let d = to; d >= from; d = addDays(d, -1)) if (!done.has(d)) out.push(d);
  return out;
}

export interface BackfillOptions {
  days: number;
  now?: number;
  delayMs?: number;
  log?: Pick<FastifyBaseLogger, "info" | "warn">;
}

/**
 * Fill every missing day in the last `days` calendar days. Sequential with a
 * pause between days: the archive is a shared public service, not ours.
 */
export async function backfill(db: Db, nse: NseArchive, { days, now = Date.now(), delayMs = 400, log }: BackfillOptions): Promise<DayResult[]> {
  // Today only counts once the file should exist.
  const today = istDate(now);
  const to = istMinutes(now) >= EOD_READY_MINUTES ? today : addDays(today, -1);
  const dates = await missingDates(db, addDays(to, -(days - 1)), to);
  const results: DayResult[] = [];
  for (const date of dates) {
    const r = await ingestDay(db, nse, date, now);
    results.push(r);
    if (r.status === "failed") log?.warn({ date, error: r.error }, "eod ingest failed");
    else if (r.status === "ok") log?.info({ date, rows: r.rows }, "eod ingested");
    if (!isWeekend(date) && delayMs > 0) await new Promise((res) => setTimeout(res, delayMs));
  }
  return results;
}
