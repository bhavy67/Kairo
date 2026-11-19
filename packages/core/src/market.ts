/** Response shapes for /api/market/*, shared by API and web. */

export interface IndexQuote {
  name: string;
  close: number;
  changePct: number | null;
  pe: number | null;
  /** Recent closes, oldest first, for a sparkline. */
  history: { date: string; close: number }[];
}

export interface Breadth {
  universe: string;
  advances: number;
  declines: number;
  unchanged: number;
  /** Fraction of stocks with enough history whose close is above the SMA. */
  above50: number | null;
  above200: number | null;
  newHighs: number;
  newLows: number;
}

export interface SectorMove {
  industry: string;
  stocks: number;
  /** Equal-weighted mean day change. NSE files carry no market cap to weight by. */
  avgChangePct: number;
  advances: number;
  declines: number;
}

export interface Mover {
  symbol: string;
  name: string;
  industry: string;
  close: number;
  changePct: number;
  volume: number;
  /** Today's volume ÷ mean volume of the previous 20 sessions. */
  volumeRatio: number | null;
}

export interface MarketOverview {
  /** Trading date the figures belong to (EOD). Null when no data is loaded yet. */
  asOf: string | null;
  indices: IndexQuote[];
  breadth: Breadth | null;
  sectors: SectorMove[];
  gainers: Mover[];
  losers: Mover[];
  volumeSpikes: Mover[];
}

export interface IngestRun {
  source: string;
  date: string;
  status: "ok" | "skipped" | "failed";
  rows: number;
  error: string | null;
  finishedAt: string;
}

export interface WatchItem extends Partial<Mover> {
  symbol: string;
  note: string | null;
  addedAt: string;
}

/** One stock on one day with the rolling context the SQL layer computes. */
export interface UniverseRow {
  symbol: string;
  name: string;
  industry: string;
  close: number;
  prevClose: number;
  high: number;
  low: number;
  volume: number;
  avgVol20: number | null;
  sma50: number | null;
  n50: number;
  sma200: number | null;
  n200: number;
  /** Highest high / lowest low of the previous 250 sessions (about a year). */
  hi52: number | null;
  lo52: number | null;
  n52: number;
}

export interface MarketStats {
  breadth: Breadth;
  sectors: SectorMove[];
  gainers: Mover[];
  losers: Mover[];
  volumeSpikes: Mover[];
}

const MIN_52W_HISTORY = 200;

/**
 * Breadth, sector moves and movers for one day. Pure, so every rule
 * (eligibility, thresholds, ties) is unit-tested without a database.
 */
export function marketStats(
  rows: readonly UniverseRow[],
  universe: string,
  { top = 10, spikeRatio = 2 }: { top?: number; spikeRatio?: number } = {},
): MarketStats {
  const movers: Mover[] = rows
    .filter((r) => r.prevClose > 0)
    .map((r) => ({
      symbol: r.symbol,
      name: r.name,
      industry: r.industry,
      close: r.close,
      changePct: r.close / r.prevClose - 1,
      volume: r.volume,
      volumeRatio: r.avgVol20 && r.avgVol20 > 0 ? r.volume / r.avgVol20 : null,
    }));

  const share = (eligible: number, hits: number) => (eligible === 0 ? null : hits / eligible);
  const e50 = rows.filter((r) => r.n50 >= 50 && r.sma50 !== null);
  const e200 = rows.filter((r) => r.n200 >= 200 && r.sma200 !== null);
  const e52 = rows.filter((r) => r.n52 >= MIN_52W_HISTORY);

  const breadth: Breadth = {
    universe,
    advances: movers.filter((m) => m.changePct > 0).length,
    declines: movers.filter((m) => m.changePct < 0).length,
    unchanged: movers.filter((m) => m.changePct === 0).length,
    above50: share(e50.length, e50.filter((r) => r.close > r.sma50!).length),
    above200: share(e200.length, e200.filter((r) => r.close > r.sma200!).length),
    newHighs: e52.filter((r) => r.hi52 !== null && r.high > r.hi52).length,
    newLows: e52.filter((r) => r.lo52 !== null && r.low < r.lo52).length,
  };

  const bySector = new Map<string, Mover[]>();
  for (const m of movers) bySector.set(m.industry, [...(bySector.get(m.industry) ?? []), m]);
  const sectors: SectorMove[] = [...bySector]
    .map(([industry, ms]) => ({
      industry,
      stocks: ms.length,
      avgChangePct: ms.reduce((s, m) => s + m.changePct, 0) / ms.length,
      advances: ms.filter((m) => m.changePct > 0).length,
      declines: ms.filter((m) => m.changePct < 0).length,
    }))
    .sort((a, b) => b.avgChangePct - a.avgChangePct);

  const byChange = [...movers].sort((a, b) => b.changePct - a.changePct || a.symbol.localeCompare(b.symbol));
  return {
    breadth,
    sectors,
    gainers: byChange.filter((m) => m.changePct > 0).slice(0, top),
    losers: byChange.filter((m) => m.changePct < 0).reverse().slice(0, top),
    volumeSpikes: movers
      .filter((m) => m.volumeRatio !== null && m.volumeRatio >= spikeRatio)
      .sort((a, b) => b.volumeRatio! - a.volumeRatio!)
      .slice(0, top),
  };
}
