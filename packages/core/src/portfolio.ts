import type { FundHolding, Holding } from "./types.js";

export interface Valuation {
  invested: number;
  current: number;
  pnl: number;
  /** Fraction, e.g. 0.12 for 12%. Null when nothing was invested. */
  pnlPct: number | null;
}

export interface HoldingView extends Holding, Valuation {
  dayChange: number;
  dayChangePct: number | null;
  /** Share of total equity value, as a fraction. */
  weight: number;
}

export interface FundHoldingView extends FundHolding, Valuation {
  weight: number;
}

export interface PortfolioSummary {
  equity: Valuation & { dayChange: number; dayChangePct: number | null };
  funds: Valuation;
  total: Valuation;
  allocation: { equity: number; funds: number };
}

const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den);

function value(invested: number, current: number): Valuation {
  return { invested, current, pnl: current - invested, pnlPct: ratio(current - invested, invested) };
}

export function valueHoldings(holdings: readonly Holding[]): HoldingView[] {
  const total = holdings.reduce((sum, h) => sum + h.quantity * h.lastPrice, 0);
  return holdings.map((h) => {
    const v = value(h.quantity * h.averagePrice, h.quantity * h.lastPrice);
    const dayChange = h.quantity * (h.lastPrice - h.previousClose);
    return {
      ...h,
      ...v,
      dayChange,
      dayChangePct: ratio(h.lastPrice - h.previousClose, h.previousClose),
      weight: total === 0 ? 0 : v.current / total,
    };
  });
}

export function valueFunds(funds: readonly FundHolding[]): FundHoldingView[] {
  const total = funds.reduce((sum, f) => sum + f.units * f.lastNav, 0);
  return funds.map((f) => {
    const v = value(f.units * f.averageNav, f.units * f.lastNav);
    return { ...f, ...v, weight: total === 0 ? 0 : v.current / total };
  });
}

export function summarize(holdings: readonly Holding[], funds: readonly FundHolding[]): PortfolioSummary {
  const eq = valueHoldings(holdings);
  const mf = valueFunds(funds);
  const sum = (xs: readonly Valuation[], k: keyof Valuation) =>
    xs.reduce((s, x) => s + (x[k] ?? 0), 0);

  const equity = value(sum(eq, "invested"), sum(eq, "current"));
  const fundsV = value(sum(mf, "invested"), sum(mf, "current"));
  const total = value(equity.invested + fundsV.invested, equity.current + fundsV.current);
  const dayChange = eq.reduce((s, h) => s + h.dayChange, 0);
  const previous = equity.current - dayChange;

  return {
    equity: { ...equity, dayChange, dayChangePct: ratio(dayChange, previous) },
    funds: fundsV,
    total,
    allocation: {
      equity: total.current === 0 ? 0 : equity.current / total.current,
      funds: total.current === 0 ? 0 : fundsV.current / total.current,
    },
  };
}

/** The /api/portfolio response: one consistent snapshot shared by API and web. */
export interface PortfolioSnapshot {
  asOf: string;
  summary: PortfolioSummary;
  cash: { available: number; used: number };
  holdings: HoldingView[];
  funds: FundHoldingView[];
}
