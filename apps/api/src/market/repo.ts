import { marketStats, type IndexQuote, type IngestRun, type MarketOverview, type UniverseRow, type WatchItem } from "@kairo/core";
import { computeIndicators, loadRows } from "./indicators.js";
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

export class MarketRepo {
  /**
   * Two layers, both keyed by trading date so a new import invalidates them
   * without any explicit hook:
   * 1. market_snapshots: computed once per day (by the import job, or by the
   *    first reader) and shared by every instance.
   * 2. An in-process promise, so a warm instance skips even that lookup and
   *    concurrent cold requests share one computation.
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
      const value = this.snapshot(asOf);
      this.cached = { asOf, value };
      value.catch(() => {
        if (this.cached?.value === value) this.cached = null;
      });
    }
    return this.cached.value;
  }

  private async snapshot(asOf: string): Promise<MarketOverview> {
    const [row] = await this.db.query<{ payload: MarketOverview }>(
      "select payload from market_snapshots where date = $1 and universe = $2",
      [asOf, UNIVERSE],
    );
    return row?.payload ?? this.refreshSnapshot(asOf);
  }

  /** Compute and store the overview for a day. Called by the import job after new data lands. */
  async refreshSnapshot(asOf?: string): Promise<MarketOverview> {
    const date = asOf ?? (await this.latestDate());
    if (!date) return { asOf: null, indices: [], breadth: null, sectors: [], gainers: [], losers: [], volumeSpikes: [] };
    const overview = await this.compute(date);
    await this.db.query(
      `insert into market_snapshots (date, universe, payload) values ($1, $2, $3::jsonb)
       on conflict (date, universe) do update set payload = excluded.payload, computed_at = now()`,
      [date, UNIVERSE, JSON.stringify(overview)],
    );
    if (this.cached?.asOf === date) this.cached = { asOf: date, value: Promise.resolve(overview) };
    return overview;
  }

  private async compute(asOf: string): Promise<MarketOverview> {
    await computeIndicators(this.db, asOf);
    const [rows, indices] = await Promise.all([loadRows(this.db, asOf, UNIVERSE), this.indices(asOf)]);
    const universe: UniverseRow[] = rows.map((r) => ({
      symbol: r.symbol, name: r.name, industry: r.industry, close: r.close, prevClose: r.prevClose,
      high: r.high, low: r.low, volume: r.volume, avgVol20: r.avgVol20, sma50: r.sma50, n50: r.n50,
      sma200: r.sma200, n200: r.n200, hi52: r.hi52, lo52: r.lo52, n52: r.n52,
    }));
    const stats = marketStats(universe, UNIVERSE);
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
              b.close, coalesce(ind.change_pct, case when b.prev_close > 0 then b.close / b.prev_close - 1 end) as "changePct",
              b.volume::float8 as volume, ind.rsi14,
              case when ind.n200 >= 200 then b.close / ind.sma200 - 1 end as "vsSma200",
              ind.ret_63d as "ret63d"
       from watchlist_items w
       left join instruments i on i.symbol = w.symbol
       left join daily_bars b on b.symbol = w.symbol and b.date = (select max(date) from daily_bars)
       left join indicators ind on ind.symbol = w.symbol and ind.date = b.date
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
