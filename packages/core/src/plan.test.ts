import { describe, expect, it } from "vitest";
import { computePlan, goalMix, requiredSip, riskProfile, SAMPLE_PLAN, type PlanInput } from "./plan.js";

const TODAY = new Date("2026-11-20T00:00:00Z");

/** Future value of a monthly SIP, invested at each month end. */
const fv = (sip: number, months: number, rate: number) => {
  const r = (1 + rate) ** (1 / 12) - 1;
  let v = 0;
  for (let i = 0; i < months; i++) v = v * (1 + r) + sip;
  return v;
};

const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  version: 1,
  income: 100000,
  essentials: 40000,
  lifestyle: 20000,
  emis: 0,
  emergency: { months: 6, saved: 240000 },
  insurance: { term: true, health: true },
  goals: [],
  risk: [2, 2, 2, 2, 2],
  assumptions: { inflation: 0.06, equity: 0.12, debt: 0.07, gold: 0.07 },
  ...over,
});

describe("requiredSip", () => {
  it("grows to the target", () => {
    const sip = requiredSip(1_000_000, 120, 0.1);
    expect(fv(sip, 120, 0.1)).toBeCloseTo(1_000_000, 0);
  });
  it("handles zero rate, zero target and a due-now goal", () => {
    expect(requiredSip(1200, 12, 0)).toBe(100);
    expect(requiredSip(0, 12, 0.1)).toBe(0);
    expect(requiredSip(5000, 0, 0.1)).toBe(5000);
  });
});

describe("riskProfile", () => {
  it("scores five answers into three bands", () => {
    expect(riskProfile([1, 1, 2, 2, 2])).toEqual({ profile: "conservative", score: 8 });
    expect(riskProfile([2, 2, 2, 3, 3])).toEqual({ profile: "balanced", score: 12 });
    expect(riskProfile([3, 3, 3, 2, 2])).toEqual({ profile: "aggressive", score: 13 });
  });
  it("assumes balanced until all questions are answered", () => {
    expect(riskProfile([3, 3])).toEqual({ profile: "balanced", score: null });
    expect(riskProfile([3, 0, 3, 3, 3])).toEqual({ profile: "balanced", score: null });
  });
});

describe("goalMix", () => {
  it("de-risks as the goal approaches and respects the cap", () => {
    expect(goalMix(10, 0.8)).toEqual({ equity: 0.8, gold: 0.1, debt: expect.closeTo(0.1) });
    expect(goalMix(6, 0.8).equity).toBe(0.6);
    expect(goalMix(4, 0.8).equity).toBe(0.4);
    expect(goalMix(2, 0.8).equity).toBe(0.2);
    expect(goalMix(0, 0.8)).toEqual({ equity: 0, gold: 0, debt: 1 });
    expect(goalMix(10, 0.4).equity).toBe(0.4);
  });
});

describe("computePlan", () => {
  it("tops up the emergency fund before goals", () => {
    const p = computePlan(base({ emergency: { months: 6, saved: 0 } }), TODAY);
    expect(p.emergency.target).toBe(240000);
    expect(p.emergency.monthly).toBe(40000); // 240,000 / 6
    expect(p.investable).toBe(0);
    expect(p.notes.some((n) => n.startsWith("Emergency fund"))).toBe(true);
  });

  it("funds goals by priority, then date", () => {
    const p = computePlan(
      base({
        goals: [
          { id: "a", name: "Trip", costToday: 5_000_000, targetYear: 2030, priority: "nice", saved: 0 },
          { id: "b", name: "Home", costToday: 3_000_000, targetYear: 2034, priority: "must", saved: 0 },
        ],
      }),
      TODAY,
    );
    const home = p.goals.find((g) => g.id === "b")!;
    const trip = p.goals.find((g) => g.id === "a")!;
    expect(home.funded).toBeCloseTo(Math.min(home.sip.base, 40000));
    expect(trip.funded).toBeCloseTo(Math.max(0, 40000 - home.sip.base));
    expect(p.totals.shortfall).toBeGreaterThan(0);
    expect(p.notes.some((n) => n.includes("Short by"))).toBe(true);
  });

  it("orders scenarios: cautious needs the most", () => {
    const p = computePlan(base({ goals: [{ id: "r", name: "Retire", costToday: 1e7, targetYear: 2050, priority: "must", saved: 0 }] }), TODAY);
    const g = p.goals[0]!;
    expect(g.sip.cautious).toBeGreaterThan(g.sip.base);
    expect(g.sip.base).toBeGreaterThan(g.sip.optimistic);
  });

  it("credits money already saved", () => {
    const goal = { id: "x", name: "X", costToday: 1_000_000, targetYear: 2031, priority: "must" as const, saved: 0 };
    const none = computePlan(base({ goals: [goal] }), TODAY).goals[0]!;
    const some = computePlan(base({ goals: [{ ...goal, saved: 500000 }] }), TODAY).goals[0]!;
    const all = computePlan(base({ goals: [{ ...goal, saved: 2_000_000 }] }), TODAY).goals[0]!;
    expect(some.sip.base).toBeLessThan(none.sip.base);
    expect(all.sip.base).toBe(0);
    expect(all.status).toBe("funded");
  });

  it("treats a goal due this year as a lump sum", () => {
    const p = computePlan(base({ goals: [{ id: "n", name: "Wedding", costToday: 800000, targetYear: 2026, priority: "must", saved: 300000 }] }), TODAY);
    expect(p.goals[0]!.dueNow).toBe(true);
    expect(p.totals.required).toBe(0);
    expect(p.notes.some((n) => n.includes("lump sum"))).toBe(true);
  });

  it("suggests directing new money to the underweight class, not selling", () => {
    const p = computePlan(
      base({ goals: [{ id: "r", name: "Retire", costToday: 1e7, targetYear: 2050, priority: "must", saved: 0 }] }),
      TODAY,
      { total: 100, value: { equity: 100, debt: 0, gold: 0 }, share: { equity: 1, debt: 0, gold: 0 } },
    );
    expect(p.gap!.equity).toBeLessThan(0);
    expect(p.notes.some((n) => n.includes("instead of selling"))).toBe(true);
  });

  it("flags missing insurance and overspending", () => {
    const p = computePlan(base({ income: 50000, insurance: { term: false, health: false } }), TODAY);
    expect(p.monthly.surplus).toBe(-10000);
    expect(p.investable).toBe(0);
    expect(p.notes.length).toBeGreaterThanOrEqual(3);
  });

  it("splits each month's money into classes that add up", () => {
    const p = computePlan(SAMPLE_PLAN, TODAY);
    const split = p.monthlySplit.equity + p.monthlySplit.debt + p.monthlySplit.gold;
    expect(split).toBeCloseTo(p.totals.funded + p.emergency.monthly);
    expect(p.target.equity + p.target.debt + p.target.gold).toBeCloseTo(1);
  });
});
