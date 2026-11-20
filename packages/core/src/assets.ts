import type { FundHolding, Holding } from "./types.js";

/**
 * Asset classes for planning. Kept to the three that drive long-term outcomes
 * for an Indian investor; cash and liquid funds count as debt.
 */
export interface AssetMix {
  equity: number;
  debt: number;
  gold: number;
}

const mix = (equity: number, debt: number, gold = 0): AssetMix => ({ equity, debt, gold });

const byName = (name: string): AssetMix | null => {
  const n = name.toUpperCase();
  if (/\bGOLD\b|\bSILVER\b|GOLDBEES|SILVERBEES/.test(n)) return mix(0, 0, 1);
  if (/LIQUID|OVERNIGHT|MONEY MARKET|GILT|BOND|DEBT|SDL|TREASURY|ARBITRAGE|\bPSU\b.*DEBT/.test(n)) return mix(0, 1);
  return null;
};

/**
 * A mutual fund's mix from its SEBI category (as AMFI publishes it), falling back
 * to the scheme name. Hybrids use typical mandates, not the fund's actual book:
 * good enough for allocation, not for tax.
 */
export function classifyFund(category: string | null, name: string): AssetMix {
  const c = (category ?? "").toLowerCase();
  if (/gold etf|silver etf/.test(c)) return mix(0, 0, 1);
  if (/arbitrage/.test(c)) return mix(0, 1); // equity-taxed, debt-like risk
  if (/aggressive hybrid/.test(c)) return mix(0.75, 0.25);
  if (/conservative hybrid/.test(c)) return mix(0.25, 0.75);
  if (/equity savings/.test(c)) return mix(0.35, 0.65);
  if (/multi asset/.test(c)) return mix(0.5, 0.3, 0.2);
  if (/balanced|dynamic asset|hybrid/.test(c)) return mix(0.5, 0.5);
  if (/debt|gilt|liquid|money market|overnight|income/.test(c)) return mix(0, 1);
  if (/equity|elss|index|overseas|growth/.test(c)) return byName(name) ?? mix(1, 0);
  if (/children|retirement|solution/.test(c)) return mix(0.6, 0.4);
  return byName(name) ?? mix(1, 0);
}

/**
 * An exchange-traded holding's mix. ETFs carry ISINs starting "INF"; gold bonds
 * trade as SGB… symbols. Everything else is a stock.
 */
export function classifyHolding(h: Pick<Holding, "symbol" | "isin">): AssetMix {
  if (/^SGB/.test(h.symbol)) return mix(0, 0, 1);
  if (h.isin.startsWith("INF")) {
    const s = h.symbol.toUpperCase();
    if (/GOLD|SILV/.test(s)) return mix(0, 0, 1);
    if (/LIQUID|LIQ|GILT|BOND|SDL|MON|CASH|BBETF/.test(s)) return mix(0, 1);
  }
  return mix(1, 0);
}

export interface ActualAllocation {
  total: number;
  value: AssetMix; // rupees per class
  share: AssetMix; // fractions
}

/** What the portfolio actually holds today, by class, including broker cash as debt. */
export function actualAllocation(
  holdings: readonly Pick<Holding, "symbol" | "isin" | "quantity" | "lastPrice">[],
  funds: readonly (Pick<FundHolding, "units" | "lastNav" | "fund"> & { category?: string | null })[],
  cash: number,
): ActualAllocation {
  const value: AssetMix = { equity: 0, debt: Math.max(0, cash), gold: 0 };
  const add = (m: AssetMix, amount: number) => {
    value.equity += m.equity * amount;
    value.debt += m.debt * amount;
    value.gold += m.gold * amount;
  };
  for (const h of holdings) add(classifyHolding(h), h.quantity * h.lastPrice);
  for (const f of funds) add(classifyFund(f.category ?? null, f.fund), f.units * f.lastNav);
  const total = value.equity + value.debt + value.gold;
  const share = total > 0 ? { equity: value.equity / total, debt: value.debt / total, gold: value.gold / total } : mix(0, 0);
  return { total, value, share };
}
