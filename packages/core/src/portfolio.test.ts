import { describe, expect, it } from "vitest";
import { summarize, valueHoldings } from "./portfolio.js";
import type { FundHolding, Holding } from "./types.js";

const h = (o: Partial<Holding>): Holding => ({
  symbol: "X", exchange: "NSE", isin: "INE000000000", quantity: 10,
  averagePrice: 100, lastPrice: 110, previousClose: 105, ...o,
});
const f = (o: Partial<FundHolding>): FundHolding => ({
  folio: "1", fund: "F", isin: "INF000000000", units: 100,
  averageNav: 10, lastNav: 12, navDate: "2026-11-18", ...o,
});

describe("valueHoldings", () => {
  it("computes p&l, day change and weights", () => {
    const [a, b] = valueHoldings([h({}), h({ symbol: "Y", quantity: 30, lastPrice: 110 })]);
    expect(a!.pnl).toBe(100);
    expect(a!.pnlPct).toBeCloseTo(0.1);
    expect(a!.dayChange).toBe(50);
    expect(a!.weight).toBeCloseTo(0.25);
    expect(b!.weight).toBeCloseTo(0.75);
  });

  it("handles zero cost basis without dividing by zero", () => {
    const [a] = valueHoldings([h({ averagePrice: 0 })]);
    expect(a!.pnlPct).toBeNull();
  });

  it("returns zero weights for an empty-value portfolio", () => {
    const [a] = valueHoldings([h({ quantity: 0 })]);
    expect(a!.weight).toBe(0);
  });
});

describe("summarize", () => {
  it("combines equity and funds", () => {
    const s = summarize([h({})], [f({})]);
    expect(s.total.invested).toBe(2000);
    expect(s.total.current).toBe(2300);
    expect(s.allocation.equity).toBeCloseTo(1100 / 2300);
    // day change % is measured against yesterday's value, not today's
    expect(s.equity.dayChangePct).toBeCloseTo(50 / 1050);
  });

  it("is safe on an empty portfolio", () => {
    const s = summarize([], []);
    expect(s.total.pnlPct).toBeNull();
    expect(s.allocation).toEqual({ equity: 0, funds: 0 });
  });
});
