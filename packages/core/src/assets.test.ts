import { describe, expect, it } from "vitest";
import { actualAllocation, classifyFund, classifyHolding } from "./assets.js";

describe("classifyFund", () => {
  it("uses the AMFI category", () => {
    expect(classifyFund("Equity Scheme - Large Cap Fund", "X Bluechip")).toEqual({ equity: 1, debt: 0, gold: 0 });
    expect(classifyFund("Debt Scheme - Liquid Fund", "X Liquid")).toEqual({ equity: 0, debt: 1, gold: 0 });
    expect(classifyFund("Hybrid Scheme - Aggressive Hybrid Fund", "X")).toEqual({ equity: 0.75, debt: 0.25, gold: 0 });
    expect(classifyFund("Hybrid Scheme - Arbitrage Fund", "X")).toEqual({ equity: 0, debt: 1, gold: 0 });
    expect(classifyFund("Hybrid Scheme - Multi Asset Allocation", "X")).toEqual({ equity: 0.5, debt: 0.3, gold: 0.2 });
    expect(classifyFund("Exchange Traded Funds (ETFs) - Gold ETF", "X")).toEqual({ equity: 0, debt: 0, gold: 1 });
  });

  it("falls back to the scheme name, then to equity", () => {
    expect(classifyFund("Fund of Funds Scheme (Domestic)", "X Gold Savings Fund")).toEqual({ equity: 0, debt: 0, gold: 1 });
    expect(classifyFund(null, "X Gilt Fund - Direct Growth")).toEqual({ equity: 0, debt: 1, gold: 0 });
    expect(classifyFund(null, "X Flexi Cap")).toEqual({ equity: 1, debt: 0, gold: 0 });
  });
});

describe("classifyHolding", () => {
  it("separates stocks, gold and debt ETFs", () => {
    expect(classifyHolding({ symbol: "INFY", isin: "INE009A01021" }).equity).toBe(1);
    expect(classifyHolding({ symbol: "GOLDBEES", isin: "INF204KB17I5" }).gold).toBe(1);
    expect(classifyHolding({ symbol: "SGBAUG28V", isin: "IN0020200039" }).gold).toBe(1);
    expect(classifyHolding({ symbol: "LIQUIDBEES", isin: "INF732E01037" }).debt).toBe(1);
    expect(classifyHolding({ symbol: "NIFTYBEES", isin: "INF204KB14I2" }).equity).toBe(1);
  });
});

describe("actualAllocation", () => {
  it("sums holdings, funds and cash by class", () => {
    const a = actualAllocation(
      [
        { symbol: "INFY", isin: "INE009A01021", quantity: 10, lastPrice: 1500 }, // 15,000 equity
        { symbol: "GOLDBEES", isin: "INF204KB17I5", quantity: 100, lastPrice: 50 }, // 5,000 gold
      ],
      [{ fund: "X Liquid", units: 10, lastNav: 1000, category: "Debt Scheme - Liquid Fund" }], // 10,000 debt
      10000,
    );
    expect(a.total).toBe(40000);
    expect(a.value).toEqual({ equity: 15000, debt: 20000, gold: 5000 });
    expect(a.share.debt).toBeCloseTo(0.5);
  });

  it("is empty-safe", () => {
    expect(actualAllocation([], [], 0).share).toEqual({ equity: 0, debt: 0, gold: 0 });
  });
});
