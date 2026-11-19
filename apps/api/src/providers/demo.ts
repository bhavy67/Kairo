import type { FundHolding, Holding } from "@kairo/core";
import type { PortfolioProvider } from "./types.js";

/**
 * A fixed, plausible portfolio so the app runs with no broker account.
 * Prices drift deterministically by minute so the UI visibly refreshes.
 */
const HOLDINGS: Holding[] = [
  { symbol: "HDFCBANK", exchange: "NSE", isin: "INE040A01034", quantity: 40, averagePrice: 1520, lastPrice: 1712.4, previousClose: 1698.1 },
  { symbol: "INFY", exchange: "NSE", isin: "INE009A01021", quantity: 35, averagePrice: 1410, lastPrice: 1588.6, previousClose: 1602.3 },
  { symbol: "RELIANCE", exchange: "NSE", isin: "INE002A01018", quantity: 25, averagePrice: 2380, lastPrice: 1415.2, previousClose: 1409.9 },
  { symbol: "ITC", exchange: "NSE", isin: "INE154A01025", quantity: 120, averagePrice: 342, lastPrice: 412.75, previousClose: 410.05 },
  { symbol: "TITAN", exchange: "NSE", isin: "INE280A01028", quantity: 12, averagePrice: 3150, lastPrice: 3402.0, previousClose: 3431.5 },
  { symbol: "LT", exchange: "NSE", isin: "INE018A01030", quantity: 15, averagePrice: 2890, lastPrice: 3725.8, previousClose: 3711.0 },
];

const FUNDS: FundHolding[] = [
  { folio: "DEMO001", fund: "Flexi Cap Fund - Direct Growth", isin: "INF000D01011", units: 812.4, averageNav: 61.2, lastNav: 84.35, navDate: "2026-11-18" },
  { folio: "DEMO002", fund: "Nifty 50 Index Fund - Direct Growth", isin: "INF000D01029", units: 1540.1, averageNav: 22.8, lastNav: 27.9, navDate: "2026-11-18" },
  { folio: "DEMO003", fund: "Short Duration Debt Fund - Direct Growth", isin: "INF000D01037", units: 2100.0, averageNav: 14.1, lastNav: 15.02, navDate: "2026-11-18" },
];

function drift(symbol: string, price: number, now: number): number {
  let seed = Math.floor(now / 60_000);
  for (const c of symbol) seed = (seed * 31 + c.charCodeAt(0)) | 0;
  const pct = ((seed % 100) / 100) * 0.004; // within ±0.4%
  return Math.round(price * (1 + pct) * 100) / 100;
}

export function demoProvider(now: () => number = Date.now): PortfolioProvider {
  return {
    profile: async () => ({ userId: "DEMO", name: "Demo Investor", broker: "DEMO" }),
    funds: async () => ({ available: 48_250.5, used: 0 }),
    holdings: async () => HOLDINGS.map((h) => ({ ...h, lastPrice: drift(h.symbol, h.lastPrice, now()) })),
    fundHoldings: async () => FUNDS.map((f) => ({ ...f })),
    positions: async () => [],
  };
}
