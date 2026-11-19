import { describe, expect, it } from "vitest";
import { xirr } from "./xirr.js";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("xirr", () => {
  it("matches a simple one-year doubling", () => {
    const r = xirr([{ date: d("2025-01-01"), amount: -1000 }, { date: d("2026-01-01"), amount: 2000 }]);
    expect(r).toBeCloseTo(1, 6);
  });

  it("matches Excel's reference example (~37.34%)", () => {
    const r = xirr([
      { date: d("2008-01-01"), amount: -10000 },
      { date: d("2008-03-01"), amount: 2750 },
      { date: d("2008-10-30"), amount: 4250 },
      { date: d("2009-02-15"), amount: 3250 },
      { date: d("2009-04-01"), amount: 2750 },
    ]);
    expect(r).toBeCloseTo(0.373362535, 6);
  });

  it("handles SIP-style flows with a loss", () => {
    const flows = [0, 1, 2, 3, 4, 5].map((m) => ({ date: d(`2026-0${m + 1}-05`), amount: -5000 }));
    const r = xirr([...flows, { date: d("2026-07-05"), amount: 27000 }]);
    expect(r).not.toBeNull();
    expect(r!).toBeLessThan(0);
  });

  it("returns null when no rate can exist", () => {
    expect(xirr([{ date: d("2026-01-01"), amount: -1 }, { date: d("2026-02-01"), amount: -1 }])).toBeNull();
    expect(xirr([{ date: d("2026-01-01"), amount: -1 }])).toBeNull();
  });
});
