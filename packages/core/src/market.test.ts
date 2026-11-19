import { describe, expect, it } from "vitest";
import { marketStats, type UniverseRow } from "./market.js";

const row = (o: Partial<UniverseRow>): UniverseRow => ({
  symbol: "S", name: "S Ltd", industry: "IT", close: 100, prevClose: 100, high: 101, low: 99, volume: 1000,
  avgVol20: 1000, sma50: 95, n50: 50, sma200: 90, n200: 200, hi52: 120, lo52: 80, n52: 250, ...o,
});

describe("marketStats", () => {
  const rows = [
    row({ symbol: "A", close: 110, industry: "IT", volume: 5000 }),
    row({ symbol: "B", close: 95, industry: "IT", sma50: 96 }),
    row({ symbol: "C", close: 100, industry: "Banks", n200: 150 }),
    row({ symbol: "D", close: 130, high: 131, industry: "Banks", n50: 20, sma50: 200 }),
    row({ symbol: "E", close: 70, low: 69, industry: "Metals", avgVol20: null }),
  ];
  const s = marketStats(rows, "NIFTY 500");

  it("counts advances, declines and unchanged", () => {
    expect(s.breadth).toMatchObject({ advances: 2, declines: 2, unchanged: 1 });
  });

  it("only counts stocks with full history in SMA breadth", () => {
    // D lacks 50 sessions; of A,B,C,E only B and E are below their SMA50
    expect(s.breadth.above50).toBeCloseTo(2 / 4);
    // C lacks 200 sessions; of A,B,D,E: E (70) is below 90
    expect(s.breadth.above200).toBeCloseTo(3 / 4);
  });

  it("detects 52-week highs and lows", () => {
    expect(s.breadth.newHighs).toBe(1);
    expect(s.breadth.newLows).toBe(1);
  });

  it("ranks sectors by equal-weighted change", () => {
    expect(s.sectors.map((x) => x.industry)).toEqual(["Banks", "IT", "Metals"]);
    expect(s.sectors[0]!.avgChangePct).toBeCloseTo(0.15);
  });

  it("lists gainers, losers and volume spikes", () => {
    expect(s.gainers.map((m) => m.symbol)).toEqual(["D", "A"]);
    expect(s.losers.map((m) => m.symbol)).toEqual(["E", "B"]);
    expect(s.volumeSpikes.map((m) => [m.symbol, m.volumeRatio])).toEqual([["A", 5]]);
  });

  it("is safe on an empty universe", () => {
    const e = marketStats([], "X");
    expect(e.breadth.above50).toBeNull();
    expect(e.sectors).toEqual([]);
  });
});
