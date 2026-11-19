import { marketStats, type IndexQuote, type IngestRun, type MarketOverview, type UniverseRow, type WatchItem } from "@kairo/core";
import type { Db } from "../db/db.js";

export const UNIVERSE = "NIFTY 500";

/** Index tiles on the Markets page, in display order. */
export const HEADLINE_INDICES = [
  "Nifty 50",
  "Nifty Bank",
  "Nifty Next 50",
  "Nifty Midcap 150",
  "Nifty Smallcap 250",
  "India VIX",
  "Nifty IT",
  "Nifty Financial Services",
];

const SPARK_SESSIONS = 60;

/**
 * Per-stock rolling context for one day, in a single pass over ~400 calendar days
 * of the universe. Named windows keep the frame definitions in one place:
 *   prev20  : the 20 sessions before today (volume baseline, excludes today)
 *   last50  : today and the 49 sessions before (SMA 50)
 *   last200 : today and the 199 before (SMA 200)
 *   prev250 : the 250 sessions before today (52-week range, excludes today)
 * Counts come along so callers can ignore stocks without enough history.
 */
const UNIVERSE_SQL = `
  with w as (
    select b.symbol, b.date, b.close, b.prev_close, b.high, b.low, b.volume,
           avg(b.volume) over prev20 as avg_vol20,
           avg(b.close)  over last50 as sma50,  count(*) over last50  as n50,
           avg(b.close)  over last200 as sma200, count(*) over last200 as n200,
           max(b.high)   over prev250 as hi52,  min(b.low) over prev250 as lo52,
           count(*)      over prev250 as n52
    from daily_bars b
    join index_members m on m.symbol = b.symbol and m.index_name = $2
    where b.date between $1::date - 400 and $1::date
    window
      prev20  as (partition by b.symbol order by b.date rows between 20 preceding and 1 preceding),
      last50  as (partition by b.symbol order by b.date rows between 49 preceding and current row),
      last200 as (partition by b.symbol order by b.date rows between 199 preceding and current row),
      prev250 as (partition by b.symbol order by b.date rows between 250 preceding and 1 preceding)
  )
  select w.symbol, i.name, i.industry,
         w.close, w.prev_close as "prevClose", w.high, w.low, w.volume::float8 as volume,
         w.avg_vol20::float8 as "avgVol20", w.sma50, w.n50::int as n50, w.sma200, w.n200::int as n200,
         w.hi52, w.lo52, w.n52::int as n52
  from w join instruments i on i.symbol = w.symbol
  where w.date = $1::date`;

export class MarketRepo {
  /**
   * EOD data changes once a day, but the window query scans ~135k rows.
   * Cache the result keyed by trading date: a new import changes max(date),
   * which invalidates the entry without any explicit hook.
   */
  private cached: { asOf: string; value: Promise<MarketOverview> } | null = null;

  constructor(private readonly db: Db) {}

  async latestDate(): Promise<string | null> {
    const [r] = await this.db.query<{ d: string | null }>("select max(date)::text as d from daily_bars");
    return r?.d ?? null;
  }

  async overview(): Promise<MarketOverview> {
    const asOf = await this.latestDate();
    if (!asOf) return { asOf: null, indices: [], breadth: null, sectors: [], gainers: [], losers: [], volumeSpikes: [] };
    if (this.cached?.asOf !== asOf) {
      // Cache the promise, not the value: concurrent first requests share one query.
      const value = this.compute(asOf);
      this.cached = { asOf, value };
      value.catch(() => {
        if (this.cached?.value === value) this.cached = null;
      });
    }
    return this.cached.value;
  }

  private async compute(asOf: string): Promise<MarketOverview> {
    const [rows, indices] = await Promise.all([
      this.db.query<UniverseRow>(UNIVERSE_SQL, [asOf, UNIVERSE]),
      this.indices(asOf),
    ]);
    const stats = marketStats(rows, UNIVERSE);
    return { asOf, indices, ...stats };
  }

  private async indices(asOf: string): Promise<IndexQuote[]> {
    const rows = await this.db.query<{ name: string; date: string; close: number; change_pct: number | null; pe: number | null }>(
      `select name, date::text as date, close, change_pct, pe from (
         select *, row_number() over (partition by name order by date desc) as rn
         from index_bars where name = any($1::text[]) and date <= $2::date
       ) t where rn <= $3 order by name, date`,
      [HEADLINE_INDICES, asOf, SPARK_SESSIONS],
    );
    const byName = new Map<string, typeof rows>();
    for (const r of rows) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
    return HEADLINE_INDICES.flatMap((name) => {
      const series = byName.get(name);
      const last = series?.at(-1);
      if (!series || !last) return [];
      return [{ name, close: last.close, changePct: last.change_pct, pe: last.pe, history: series.map((s) => ({ date: s.date, close: s.close })) }];
    });
  }

  async ingestRuns(limit = 20): Promise<IngestRun[]> {
    return this.db.query<IngestRun>(
      `select source, date::text as date, status, rows, error, finished_at::text as "finishedAt"
       from ingest_runs order by date desc limit $1`,
      [limit],
    );
  }

  async sectorsByIsin(isins: string[]): Promise<Map<string, string>> {
    if (isins.length === 0) return new Map();
    const rows = await this.db.query<{ isin: string; industry: string }>(
      "select isin, industry from instruments where isin = any($1::text[])",
      [isins],
    );
    return new Map(rows.map((r) => [r.isin, r.industry]));
  }

  async symbolExists(symbol: string): Promise<boolean> {
    const [r] = await this.db.query<{ ok: boolean }>(
      "select exists (select 1 from daily_bars where symbol = $1 and date = (select max(date) from daily_bars)) as ok",
      [symbol],
    );
    return r?.ok ?? false;
  }

  async watchlist(): Promise<WatchItem[]> {
    return this.db.query<WatchItem>(
      `select w.symbol, w.note, w.added_at::text as "addedAt",
              coalesce(i.name, w.symbol) as name, i.industry,
              b.close, case when b.prev_close > 0 then b.close / b.prev_close - 1 end as "changePct",
              b.volume::float8 as volume
       from watchlist_items w
       left join instruments i on i.symbol = w.symbol
       left join daily_bars b on b.symbol = w.symbol and b.date = (select max(date) from daily_bars)
       order by w.added_at`,
    );
  }

  async addWatch(symbol: string, note: string | null): Promise<void> {
    await this.db.query(
      "insert into watchlist_items (symbol, note) values ($1, $2) on conflict (symbol) do update set note = excluded.note",
      [symbol, note],
    );
  }

  async removeWatch(symbol: string): Promise<boolean> {
    const rows = await this.db.query("delete from watchlist_items where symbol = $1 returning symbol", [symbol]);
    return rows.length > 0;
  }
}
