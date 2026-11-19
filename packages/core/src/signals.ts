/**
 * Per-stock indicators for one trading day, as stored by the nightly job, and
 * the derived signals screens and alerts run on. Everything here is pure.
 */

export interface Indicator {
  symbol: string;
  name: string;
  industry: string;
  date: string;
  close: number;
  prevClose: number;
  high: number;
  low: number;
  volume: number;
  turnover: number;
  changePct: number;
  /** Compounded from daily changes, so splits and bonuses do not distort them. */
  ret5d: number | null;
  ret21d: number | null;
  ret63d: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  sma50Prev: number | null;
  sma200Prev: number | null;
  n50: number;
  n200: number;
  /** 14-day RSI, simple-average (Cutler) variant. */
  rsi14: number | null;
  avgVol20: number | null;
  avgTurnover20: number | null;
  hi52: number | null;
  lo52: number | null;
  n52: number;
}

export interface Signals {
  volRatio: number | null;
  /** close / sma - 1 */
  vsSma50: number | null;
  vsSma200: number | null;
  /** close / 52-week high - 1 (≤ 0 unless a new high today) */
  fromHigh52: number | null;
  fromLow52: number | null;
  newHigh52: boolean;
  newLow52: boolean;
  crossAbove200: boolean;
  crossBelow200: boolean;
  goldenCross: boolean;
  deathCross: boolean;
}

export type ScreenRow = Indicator & Signals;

const rel = (a: number, b: number | null) => (b === null || b === 0 ? null : a / b - 1);

export function deriveSignals(i: Indicator): ScreenRow {
  const full52 = i.n52 >= 200;
  const has200 = i.n200 >= 200 && i.sma200 !== null && i.sma200Prev !== null;
  const hasCross = has200 && i.n50 >= 50 && i.sma50 !== null && i.sma50Prev !== null;
  return {
    ...i,
    volRatio: i.avgVol20 && i.avgVol20 > 0 ? i.volume / i.avgVol20 : null,
    vsSma50: i.n50 >= 50 ? rel(i.close, i.sma50) : null,
    vsSma200: i.n200 >= 200 ? rel(i.close, i.sma200) : null,
    fromHigh52: full52 ? rel(i.close, i.hi52) : null,
    fromLow52: full52 ? rel(i.close, i.lo52) : null,
    newHigh52: full52 && i.hi52 !== null && i.high > i.hi52,
    newLow52: full52 && i.lo52 !== null && i.low < i.lo52,
    crossAbove200: has200 && i.close > i.sma200! && i.prevClose <= i.sma200Prev!,
    crossBelow200: has200 && i.close < i.sma200! && i.prevClose >= i.sma200Prev!,
    goldenCross: hasCross && i.sma50! > i.sma200! && i.sma50Prev! <= i.sma200Prev!,
    deathCross: hasCross && i.sma50! < i.sma200! && i.sma50Prev! >= i.sma200Prev!,
  };
}

/* ---------------------------------------------------------------- screens */

export const NUMERIC_FIELDS = {
  close: "Close",
  changePct: "Day change",
  ret5d: "1-week return",
  ret21d: "1-month return",
  ret63d: "3-month return",
  rsi14: "RSI (14)",
  volRatio: "Volume ÷ 20-day avg",
  vsSma50: "vs 50-day avg",
  vsSma200: "vs 200-day avg",
  sma20: "20-day avg",
  sma50: "50-day avg",
  sma200: "200-day avg",
  fromHigh52: "From 52-week high",
  fromLow52: "From 52-week low",
  avgTurnover20: "Avg daily turnover (₹)",
} as const;

export const BOOLEAN_FIELDS = {
  newHigh52: "New 52-week high",
  newLow52: "New 52-week low",
  crossAbove200: "Crossed above 200-day avg",
  crossBelow200: "Crossed below 200-day avg",
  goldenCross: "Golden cross (50 over 200)",
  deathCross: "Death cross (50 under 200)",
} as const;

export type NumericField = keyof typeof NUMERIC_FIELDS;
export type BooleanField = keyof typeof BOOLEAN_FIELDS;
export type Comparator = ">" | ">=" | "<" | "<=";

export type Condition =
  | { field: NumericField; op: Comparator; value: number }
  | { field: NumericField; op: Comparator; other: NumericField }
  | { flag: BooleanField };

export type Universe = "NIFTY 50" | "NIFTY 500";

export interface ScreenRule {
  universe: Universe;
  /** All conditions must hold (AND). OR is two screens: easier to read and to alert on. */
  conditions: Condition[];
  sort: { field: NumericField; dir: "asc" | "desc" };
  limit: number;
}

const compare = (a: number, op: Comparator, b: number) =>
  op === ">" ? a > b : op === ">=" ? a >= b : op === "<" ? a < b : a <= b;

function matches(row: ScreenRow, c: Condition): boolean {
  if ("flag" in c) return row[c.flag];
  const left = row[c.field];
  const right = "value" in c ? c.value : row[c.other];
  // Missing data never matches: a stock without 200 days of history is not "above" its 200-day average.
  return left !== null && right !== null && compare(left, c.op, right);
}

/** Rows must already be limited to the rule's universe. */
export function runScreen(rows: readonly ScreenRow[], rule: ScreenRule): ScreenRow[] {
  const { field, dir } = rule.sort;
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .filter((r) => rule.conditions.every((c) => matches(r, c)))
    .sort((a, b) => {
      const x = a[field];
      const y = b[field];
      if (x === null) return 1;
      if (y === null) return -1;
      return (x - y) * sign || a.symbol.localeCompare(b.symbol);
    })
    .slice(0, rule.limit);
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  rule: ScreenRule;
}

/** "Stocks of the day": rules, not predictions. Each says exactly why a stock is listed. */
export const PRESETS: Preset[] = [
  {
    id: "breakouts",
    name: "52-week breakouts",
    description: "New 52-week high today on at least 1.5× normal volume.",
    rule: { universe: "NIFTY 500", conditions: [{ flag: "newHigh52" }, { field: "volRatio", op: ">=", value: 1.5 }], sort: { field: "volRatio", dir: "desc" }, limit: 25 },
  },
  {
    id: "momentum",
    name: "Momentum leaders",
    description: "Above the 50-day average, 50-day above 200-day, up more than 15% in 3 months.",
    rule: {
      universe: "NIFTY 500",
      conditions: [{ field: "close", op: ">", other: "sma50" }, { field: "sma50", op: ">", other: "sma200" }, { field: "ret63d", op: ">", value: 0.15 }],
      sort: { field: "ret63d", dir: "desc" },
      limit: 25,
    },
  },
  {
    id: "pullback",
    name: "Pullbacks in uptrends",
    description: "Long-term uptrend (above 200-day, 50 over 200) with RSI under 40.",
    rule: {
      universe: "NIFTY 500",
      conditions: [{ field: "close", op: ">", other: "sma200" }, { field: "sma50", op: ">", other: "sma200" }, { field: "rsi14", op: "<", value: 40 }],
      sort: { field: "rsi14", dir: "asc" },
      limit: 25,
    },
  },
  {
    id: "reclaim200",
    name: "Reclaimed the 200-day",
    description: "Closed above the 200-day average today after closing below it yesterday.",
    rule: { universe: "NIFTY 500", conditions: [{ flag: "crossAbove200" }], sort: { field: "volRatio", dir: "desc" }, limit: 25 },
  },
  {
    id: "volume",
    name: "Unusual volume",
    description: "Traded at least 3× the 20-day average volume.",
    rule: { universe: "NIFTY 500", conditions: [{ field: "volRatio", op: ">=", value: 3 }], sort: { field: "volRatio", dir: "desc" }, limit: 25 },
  },
  {
    id: "oversold",
    name: "Oversold large caps",
    description: "Nifty 50 stocks with RSI under 30. Oversold is a state, not a buy signal.",
    rule: { universe: "NIFTY 50", conditions: [{ field: "rsi14", op: "<", value: 30 }], sort: { field: "rsi14", dir: "asc" }, limit: 25 },
  },
];

/* ----------------------------------------------------------------- alerts */

export type AlertKind = "price_above" | "price_below" | "move_pct" | "cross_200dma";

export interface AlertRule {
  id: number;
  symbol: string;
  kind: AlertKind;
  /** Price for price_*; fraction (0.05 = 5%) for move_pct; unused for cross_200dma. */
  threshold: number | null;
}

export interface AlertHit {
  alertId: number;
  symbol: string;
  message: string;
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const inr = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * Fires on the day a condition becomes true, not every day it stays true,
 * so "above ₹2,000" alerts once per crossing instead of daily.
 */
export function evaluateAlerts(rules: readonly AlertRule[], bySymbol: ReadonlyMap<string, ScreenRow>): AlertHit[] {
  const hits: AlertHit[] = [];
  for (const r of rules) {
    const s = bySymbol.get(r.symbol);
    if (!s) continue;
    const t = r.threshold ?? 0;
    let message: string | null = null;
    if (r.kind === "price_above" && s.close > t && s.prevClose <= t) message = `${s.symbol} closed above ${inr(t)} at ${inr(s.close)}`;
    if (r.kind === "price_below" && s.close < t && s.prevClose >= t) message = `${s.symbol} closed below ${inr(t)} at ${inr(s.close)}`;
    if (r.kind === "move_pct" && Math.abs(s.changePct) >= t) message = `${s.symbol} moved ${s.changePct > 0 ? "+" : ""}${pct(s.changePct)} to ${inr(s.close)}`;
    if (r.kind === "cross_200dma" && s.crossAbove200) message = `${s.symbol} crossed above its 200-day average (${inr(s.sma200!)})`;
    if (r.kind === "cross_200dma" && s.crossBelow200) message = `${s.symbol} crossed below its 200-day average (${inr(s.sma200!)})`;
    if (message) hits.push({ alertId: r.id, symbol: r.symbol, message });
  }
  return hits;
}

/** Symbols that match today but did not match on the previous run. */
export function newMatches(today: readonly string[], previous: readonly string[] | null): string[] {
  if (previous === null) return [...today]; // first run: everything is new
  const before = new Set(previous);
  return today.filter((s) => !before.has(s));
}
