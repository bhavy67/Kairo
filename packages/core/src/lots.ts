import type { Trade } from "./tradebook.js";
import { xirr } from "./xirr.js";

/**
 * FIFO lot accounting for Indian listed equity.
 *
 * Per stock, day by day:
 *   1. corporate actions with that ex-date (before the day's trades: they trade post-action)
 *   2. same-day buys and sells net off as intraday (taxed as speculative income)
 *   3. remaining buys open lots; remaining sells close the oldest lots first
 * A sale is long-term when the lot was held for more than 12 months.
 * Not modelled: the 31-Jan-2018 grandfathering of cost, charges and STT, dividends, rights.
 */

export interface KeyedTrade extends Trade {
  /** Grouping key: the NSE symbol, so BSE and NSE trades of one stock match. */
  key: string;
}

export interface Action {
  key: string;
  exDate: string;
  split: number | null;
  bonus: number | null;
}

export interface Lot {
  key: string;
  buyDate: string;
  quantity: number;
  /** Per-share cost, tax basis. Zero for bonus shares. */
  cost: number;
  source: "trade" | "bonus";
}

export type Term = "intraday" | "short" | "long";

export interface Realized {
  key: string;
  sellDate: string;
  buyDate: string;
  quantity: number;
  buyPrice: number;
  sellPrice: number;
  pnl: number;
  term: Term;
  /** Indian financial year of the sale, e.g. "FY 2025-26". */
  fy: string;
}

export interface Unmatched {
  key: string;
  date: string;
  quantity: number;
}

export interface LotResult {
  lots: Lot[];
  realized: Realized[];
  /** Sold shares with no recorded purchase: the tradebook starts too late, or shares came from IPO/transfer. */
  unmatched: Unmatched[];
}

const EPS = 1e-9;

export function financialYear(iso: string): string {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `FY ${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Held for more than 12 months: sold after the same calendar date one year later. */
export function isLongTerm(buyDate: string, sellDate: string): boolean {
  const [y, m, d] = buyDate.split("-");
  return sellDate > `${Number(y) + 1}-${m}-${d}`;
}

const byTime = (a: Trade, b: Trade) => (a.executedAt ?? "").localeCompare(b.executedAt ?? "");

export function matchLots(trades: readonly KeyedTrade[], actions: readonly Action[] = []): LotResult {
  const lots: Lot[] = [];
  const realized: Realized[] = [];
  const unmatched: Unmatched[] = [];

  const keys = new Set(trades.map((t) => t.key));
  for (const key of keys) {
    const mine = trades.filter((t) => t.key === key);
    const acts = actions.filter((a) => a.key === key);
    const days = [...new Set([...mine.map((t) => t.date), ...acts.map((a) => a.exDate)])].sort();
    let open: Lot[] = [];

    const close = (date: string, qty: number, price: number, from: Lot[], term: Term | null) => {
      let left = qty;
      for (const lot of from) {
        if (left <= EPS) break;
        if (lot.quantity <= EPS) continue;
        const take = Math.min(lot.quantity, left);
        lot.quantity -= take;
        left -= take;
        realized.push({
          key, sellDate: date, buyDate: lot.buyDate, quantity: take, buyPrice: lot.cost, sellPrice: price,
          pnl: take * (price - lot.cost), term: term ?? (isLongTerm(lot.buyDate, date) ? "long" : "short"), fy: financialYear(date),
        });
      }
      return left;
    };

    for (const day of days) {
      for (const a of acts.filter((x) => x.exDate === day)) {
        if (a.split) for (const lot of open) {
          lot.quantity *= a.split;
          lot.cost /= a.split;
        }
        if (a.bonus) {
          const held = open.reduce((s, l) => s + l.quantity, 0);
          // Entitlements are rounded down; fractional bonus is paid out, not credited.
          const extra = Math.floor(held * (a.bonus - 1) + EPS);
          if (extra > 0) open.push({ key, buyDate: day, quantity: extra, cost: 0, source: "bonus" });
        }
      }

      const buys = mine.filter((t) => t.date === day && t.side === "buy").sort(byTime);
      const sells = mine.filter((t) => t.date === day && t.side === "sell").sort(byTime);
      const dayLots: Lot[] = buys.map((b) => ({ key, buyDate: day, quantity: b.quantity, cost: b.price, source: "trade" }));

      for (const s of sells) {
        let left = close(day, s.quantity, s.price, dayLots, "intraday");
        left = close(day, left, s.price, open, null);
        if (left > EPS) unmatched.push({ key, date: day, quantity: left });
      }
      open = [...open, ...dayLots].filter((l) => l.quantity > EPS);
    }
    lots.push(...open);
  }
  return { lots, realized, unmatched };
}

/* ------------------------------------------------------------ summaries */

export interface PositionSummary {
  key: string;
  symbol: string;
  openQuantity: number;
  /** Tax-basis average (bonus shares at zero cost). */
  avgCost: number | null;
  invested: number;
  currentPrice: number | null;
  currentValue: number | null;
  unrealized: number | null;
  realized: number;
  xirr: number | null;
  /** Broker quantity for reconciliation; null when the broker does not report this stock. */
  brokerQuantity: number | null;
}

export interface FySummary {
  fy: string;
  short: number;
  long: number;
  intraday: number;
}

export interface TradeSummary {
  coverage: { from: string; to: string; trades: number } | null;
  xirr: number | null;
  invested: number;
  currentValue: number;
  realized: number;
  unrealized: number;
  byFy: FySummary[];
  positions: PositionSummary[];
  recent: Realized[];
  unmatched: Unmatched[];
  /** Stocks where the tradebook and the broker disagree on quantity held. */
  mismatches: { key: string; tradebook: number; broker: number }[];
}

/**
 * Everything the Returns page needs. `prices` values open lots today (XIRR terminal
 * value); `broker` is the broker's own quantity per key for reconciliation.
 */
export function summarizeTrades(
  trades: readonly KeyedTrade[],
  result: LotResult,
  prices: ReadonlyMap<string, number>,
  broker: ReadonlyMap<string, number>,
  today: string,
): TradeSummary {
  const dates = trades.map((t) => t.date).sort();
  const todayDate = new Date(`${today}T00:00:00Z`);
  const keys = [...new Set([...trades.map((t) => t.key), ...broker.keys()])].sort();
  const symbolOf = (key: string) => [...trades].reverse().find((t) => t.key === key)?.symbol ?? key;

  const positions: PositionSummary[] = keys.map((key) => {
    const lots = result.lots.filter((l) => l.key === key);
    const qty = lots.reduce((s, l) => s + l.quantity, 0);
    const invested = lots.reduce((s, l) => s + l.quantity * l.cost, 0);
    const price = prices.get(key) ?? null;
    const value = price === null ? null : qty * price;
    const flows = trades
      .filter((t) => t.key === key)
      .map((t) => ({ date: new Date(`${t.date}T00:00:00Z`), amount: (t.side === "buy" ? -1 : 1) * t.quantity * t.price }));
    if (value) flows.push({ date: todayDate, amount: value });
    return {
      key,
      symbol: symbolOf(key),
      openQuantity: qty,
      avgCost: qty > EPS ? invested / qty : null,
      invested,
      currentPrice: price,
      currentValue: value,
      unrealized: value === null ? null : value - invested,
      realized: result.realized.filter((r) => r.key === key).reduce((s, r) => s + r.pnl, 0),
      xirr: flows.length >= 2 ? xirr(flows) : null,
      brokerQuantity: broker.get(key) ?? null,
    };
  });

  const allFlows = trades.map((t) => ({ date: new Date(`${t.date}T00:00:00Z`), amount: (t.side === "buy" ? -1 : 1) * t.quantity * t.price }));
  const currentValue = positions.reduce((s, p) => s + (p.currentValue ?? 0), 0);
  if (currentValue > 0) allFlows.push({ date: todayDate, amount: currentValue });

  const fyMap = new Map<string, FySummary>();
  for (const r of result.realized) {
    const f = fyMap.get(r.fy) ?? { fy: r.fy, short: 0, long: 0, intraday: 0 };
    f[r.term === "long" ? "long" : r.term === "short" ? "short" : "intraday"] += r.pnl;
    fyMap.set(r.fy, f);
  }

  return {
    coverage: dates.length ? { from: dates[0]!, to: dates.at(-1)!, trades: trades.length } : null,
    xirr: allFlows.length >= 2 ? xirr(allFlows) : null,
    invested: positions.reduce((s, p) => s + p.invested, 0),
    currentValue,
    realized: result.realized.reduce((s, r) => s + r.pnl, 0),
    unrealized: positions.reduce((s, p) => s + (p.unrealized ?? 0), 0),
    byFy: [...fyMap.values()].sort((a, b) => b.fy.localeCompare(a.fy)),
    positions: positions.filter((p) => p.openQuantity > EPS || p.realized !== 0 || p.brokerQuantity !== null),
    recent: [...result.realized].sort((a, b) => b.sellDate.localeCompare(a.sellDate)).slice(0, 100),
    unmatched: result.unmatched,
    mismatches: positions
      .filter((p) => p.brokerQuantity !== null && Math.abs(p.brokerQuantity - p.openQuantity) > EPS)
      .map((p) => ({ key: p.key, tradebook: p.openQuantity, broker: p.brokerQuantity! })),
  };
}
