import { GLOBAL_SERIES, parseEcbRates, parseFredCsv, type Point } from "@kairo/core";
import type { Db } from "../db/db.js";
import type { Fetch } from "../kite/client.js";
import { addDays, istDate } from "../market/calendar.js";

export interface GlobalSources {
  fredUrl: string;
  fxUrl: string;
  fetch: Fetch;
}

export interface GlobalJobResult {
  ok: string[];
  failed: { id: string; error: string }[];
  rows: number;
}

const HISTORY_DAYS = 400;
const OVERLAP_DAYS = 10; // re-read recent days: sources revise and back-fill late prints

async function getText(f: Fetch, url: string): Promise<string> {
  const res = await f(url, { headers: { "User-Agent": "kairo/0.1 (personal dashboard)" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function upsert(db: Db, id: string, points: Point[]): Promise<number> {
  if (points.length === 0) return 0;
  await db.query(
    `insert into global_series (id, date, value)
     select $1, * from unnest($2::date[], $3::float8[])
     on conflict (id, date) do update set value = excluded.value`,
    [id, points.map((p) => p.date), points.map((p) => p.value)],
  );
  return points.length;
}

/** Start date per series: full history on first run, otherwise a short overlap. */
async function startDates(db: Db, today: string): Promise<Map<string, string>> {
  const rows = await db.query<{ id: string; last: string }>("select id, max(date)::text as last from global_series group by id");
  const last = new Map(rows.map((r) => [r.id, r.last]));
  return new Map(GLOBAL_SERIES.map((s) => [s.id, last.has(s.id) ? addDays(last.get(s.id)!, -OVERLAP_DAYS) : addDays(today, -HISTORY_DAYS)]));
}

/**
 * Refresh every global series. Each source fails independently: a FRED outage
 * still leaves fresh currency rates, and the page shows each series' own date.
 * Idempotent (upserts keyed by series and date), so any scheduler can call it.
 */
export async function runGlobalJob(db: Db, src: GlobalSources, now: number = Date.now()): Promise<GlobalJobResult> {
  const today = istDate(now);
  const start = await startDates(db, today);
  const result: GlobalJobResult = { ok: [], failed: [], rows: 0 };

  const fred = GLOBAL_SERIES.filter((s) => s.source === "fred");
  await Promise.all(
    fred.map(async (s) => {
      try {
        const csv = await getText(src.fetch, `${src.fredUrl}/graph/fredgraph.csv?id=${s.code}&cosd=${start.get(s.id)}`);
        result.rows += await upsert(db, s.id, parseFredCsv(csv));
        result.ok.push(s.id);
      } catch (err) {
        result.failed.push({ id: s.id, error: (err as Error).message });
      }
    }),
  );

  const fx = GLOBAL_SERIES.filter((s) => s.source === "ecb");
  try {
    const from = [...fx.map((s) => start.get(s.id)!)].sort()[0]!;
    const body = await getText(src.fetch, `${src.fxUrl}/${from}..?base=INR&symbols=${fx.map((s) => s.code).join(",")}`);
    const rates = parseEcbRates(JSON.parse(body), fx.map((s) => s.code));
    for (const s of fx) {
      result.rows += await upsert(db, s.id, rates.get(s.code) ?? []);
      result.ok.push(s.id);
    }
  } catch (err) {
    for (const s of fx) result.failed.push({ id: s.id, error: (err as Error).message });
  }
  return result;
}
