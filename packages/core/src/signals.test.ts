import { describe, expect, it } from "vitest";
import { deriveSignals, evaluateAlerts, newMatches, PRESETS, runScreen, type Indicator, type ScreenRule } from "./signals.js";

const ind = (o: Partial<Indicator>): Indicator => ({
  symbol: "S", name: "S Ltd", industry: "IT", date: "2026-11-18",
  close: 100, prevClose: 99, high: 101, low: 98, volume: 1000, turnover: 1e8, changePct: 100 / 99 - 1,
  ret5d: 0.01, ret21d: 0.02, ret63d: 0.05,
  sma20: 98, sma50: 95, sma200: 90, sma50Prev: 95, sma200Prev: 90, n50: 50, n200: 200,
  rsi14: 55, avgVol20: 1000, avgTurnover20: 1e8, hi52: 120, lo52: 80, n52: 250, ...o,
});

describe("deriveSignals", () => {
  it("computes ratios and distances", () => {
    const s = deriveSignals(ind({ volume: 3000 }));
    expect(s.volRatio).toBe(3);
    expect(s.vsSma200).toBeCloseTo(100 / 90 - 1);
    expect(s.fromHigh52).toBeCloseTo(100 / 120 - 1);
  });

  it("detects crosses only on the day they happen", () => {
    expect(deriveSignals(ind({ close: 101, prevClose: 99, sma200: 100, sma200Prev: 100 })).crossAbove200).toBe(true);
    expect(deriveSignals(ind({ close: 101, prevClose: 100.5, sma200: 100, sma200Prev: 100 })).crossAbove200).toBe(false);
    expect(deriveSignals(ind({ sma50: 101, sma200: 100, sma50Prev: 99, sma200Prev: 100 })).goldenCross).toBe(true);
  });

  it("never claims a signal without enough history", () => {
    const s = deriveSignals(ind({ n200: 120, n52: 100, high: 999 }));
    expect(s.vsSma200).toBeNull();
    expect(s.newHigh52).toBe(false);
    expect(s.crossAbove200).toBe(false);
  });
});

describe("runScreen", () => {
  const rows = [
    deriveSignals(ind({ symbol: "A", rsi14: 25, ret63d: 0.3 })),
    deriveSignals(ind({ symbol: "B", rsi14: 35, ret63d: 0.2 })),
    deriveSignals(ind({ symbol: "C", rsi14: null, ret63d: 0.5 })),
    deriveSignals(ind({ symbol: "D", rsi14: 70, ret63d: -0.1, close: 80 })),
  ];

  it("ANDs conditions, ignores missing data and sorts", () => {
    const rule: ScreenRule = {
      universe: "NIFTY 500",
      conditions: [{ field: "rsi14", op: "<", value: 40 }, { field: "close", op: ">", other: "sma200" }],
      sort: { field: "rsi14", dir: "asc" },
      limit: 10,
    };
    expect(runScreen(rows, rule).map((r) => r.symbol)).toEqual(["A", "B"]);
  });

  it("puts nulls last and respects the limit", () => {
    const rule: ScreenRule = { universe: "NIFTY 500", conditions: [], sort: { field: "rsi14", dir: "desc" }, limit: 3 };
    expect(runScreen(rows, rule).map((r) => r.symbol)).toEqual(["D", "B", "A"]);
  });

  it("ships presets that all run", () => {
    for (const p of PRESETS) expect(() => runScreen(rows, p.rule)).not.toThrow();
    expect(runScreen(rows, PRESETS.find((p) => p.id === "momentum")!.rule).map((r) => r.symbol)).toEqual(["C", "A", "B"]);
  });
});

describe("evaluateAlerts", () => {
  const rows = new Map([
    ["UP", deriveSignals(ind({ symbol: "UP", close: 2010, prevClose: 1990, changePct: 0.01 }))],
    ["DROP", deriveSignals(ind({ symbol: "DROP", close: 94, prevClose: 100, changePct: -0.06 }))],
  ]);

  it("fires price alerts on the crossing day only", () => {
    const hits = evaluateAlerts(
      [
        { id: 1, symbol: "UP", kind: "price_above", threshold: 2000 },
        { id: 2, symbol: "UP", kind: "price_above", threshold: 1900 }, // already above yesterday
        { id: 3, symbol: "DROP", kind: "price_below", threshold: 95 },
      ],
      rows,
    );
    expect(hits.map((h) => h.alertId)).toEqual([1, 3]);
    expect(hits[0]!.message).toBe("UP closed above ₹2,000 at ₹2,010");
  });

  it("fires on big moves either way and skips unknown symbols", () => {
    const hits = evaluateAlerts(
      [
        { id: 4, symbol: "DROP", kind: "move_pct", threshold: 0.05 },
        { id: 5, symbol: "UP", kind: "move_pct", threshold: 0.05 },
        { id: 6, symbol: "NOPE", kind: "move_pct", threshold: 0.01 },
      ],
      rows,
    );
    expect(hits.map((h) => [h.alertId, h.message])).toEqual([[4, "DROP moved -6.00% to ₹94"]]);
  });
});

it("newMatches reports only fresh symbols", () => {
  expect(newMatches(["A", "B", "C"], ["B"])).toEqual(["A", "C"]);
  expect(newMatches(["A"], null)).toEqual(["A"]);
});
