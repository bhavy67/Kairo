import type { ActualAllocation, AssetMix } from "./assets.js";

/**
 * Goal-based planning. Everything here is arithmetic on the user's own inputs and
 * visible assumptions; nothing recommends a product. Rules, in order:
 *   1. Safety first: the emergency fund is topped up (over 6 months) before goals.
 *   2. Each goal gets an asset mix from its time horizon, capped by risk tolerance.
 *   3. The required monthly SIP comes from the goal's inflated cost, minus what the
 *      money already saved for it will grow to.
 *   4. The investable surplus funds goals by priority, then by date.
 *   5. Results come in three return scenarios, so no single number looks certain.
 */

export type Priority = "must" | "should" | "nice";

export interface PlanGoal {
  id: string;
  name: string;
  /** Cost in today's rupees. */
  costToday: number;
  targetYear: number;
  priority: Priority;
  /** Already set aside for this goal, in rupees. */
  saved: number;
  /** Goal-specific inflation (education runs hotter than general prices). Defaults to the plan's. */
  inflation?: number;
}

export interface PlanInput {
  version: 1;
  /** Monthly take-home income. */
  income: number;
  /** Monthly essential spending (rent, food, bills, insurance premiums). */
  essentials: number;
  /** Monthly discretionary spending. */
  lifestyle: number;
  /** Monthly loan EMIs. */
  emis: number;
  emergency: { months: number; saved: number };
  insurance: { term: boolean; health: boolean };
  goals: PlanGoal[];
  /** Answers to RISK_QUESTIONS (1 = most cautious, 3 = most aggressive). Empty = not answered. */
  risk: number[];
  /** Annual rates as fractions. */
  assumptions: { inflation: number; equity: number; debt: number; gold: number };
}

/* ------------------------------------------------------------- risk */

export const RISK_QUESTIONS = [
  {
    q: "Your portfolio falls 25% in a month. What do you do?",
    options: ["Sell to stop further losses", "Hold and wait", "Invest more while prices are low"],
  },
  {
    q: "When will you need most of this money?",
    options: ["Within 3 years", "In 3 to 7 years", "More than 7 years away"],
  },
  {
    q: "How stable is your income?",
    options: ["Variable or uncertain", "Stable salary", "Stable, with other income or savings as backup"],
  },
  {
    q: "Which would you choose?",
    options: ["A steady 7% a year", "About 10% a year, with some down years", "About 13% a year, with occasional falls of 30%"],
  },
  {
    q: "How long have you invested in stocks or equity funds?",
    options: ["Not yet, or under a year", "1 to 5 years", "More than 5 years, through at least one crash"],
  },
] as const;

export type RiskProfile = "conservative" | "balanced" | "aggressive";

/** Most equity any goal gets, by profile. */
export const EQUITY_CAP: Record<RiskProfile, number> = { conservative: 0.4, balanced: 0.6, aggressive: 0.8 };

export function riskProfile(answers: readonly number[]): { profile: RiskProfile; score: number | null } {
  if (answers.length !== RISK_QUESTIONS.length) return { profile: "balanced", score: null };
  const score = answers.reduce((s, a) => s + a, 0);
  return { profile: score <= 8 ? "conservative" : score <= 12 ? "balanced" : "aggressive", score };
}

/* --------------------------------------------------------- arithmetic */

/** Asset mix by years to the goal, capped by risk tolerance. Gold diversifies long goals only. */
export function goalMix(years: number, cap: number): AssetMix {
  const equity = years >= 7 ? cap : years >= 5 ? Math.min(cap, 0.6) : years >= 3 ? Math.min(cap, 0.4) : years >= 1 ? Math.min(cap, 0.2) : 0;
  const gold = years >= 5 ? 0.1 : 0;
  return { equity, gold, debt: Math.max(0, 1 - equity - gold) };
}

export function blendedReturn(m: AssetMix, a: PlanInput["assumptions"]): number {
  return m.equity * a.equity + m.debt * a.debt + m.gold * a.gold;
}

/** Monthly investment (end of each month) that grows to `target` in `months` at annual `rate`. */
export function requiredSip(target: number, months: number, rate: number): number {
  if (target <= 0) return 0;
  if (months <= 0) return target; // due now: a lump sum, not a SIP
  const r = (1 + rate) ** (1 / 12) - 1;
  if (r === 0) return target / months;
  return (target * r) / ((1 + r) ** months - 1);
}

export const SCENARIOS = {
  cautious: { equity: -0.02, debt: -0.01, gold: -0.02 },
  base: { equity: 0, debt: 0, gold: 0 },
  optimistic: { equity: 0.02, debt: 0.01, gold: 0.02 },
} as const;
export type Scenario = keyof typeof SCENARIOS;

const shifted = (a: PlanInput["assumptions"], s: Scenario) => ({
  ...a,
  equity: a.equity + SCENARIOS[s].equity,
  debt: a.debt + SCENARIOS[s].debt,
  gold: a.gold + SCENARIOS[s].gold,
});

/* ------------------------------------------------------------- result */

export interface GoalResult {
  id: string;
  name: string;
  priority: Priority;
  years: number;
  futureCost: number;
  mix: AssetMix;
  expectedReturn: number;
  /** Monthly SIP needed under each scenario. */
  sip: Record<Scenario, number>;
  /** True when the goal is this year: the gap is a lump sum, not a SIP. */
  dueNow: boolean;
  /** How much of the base-case SIP the surplus covers. */
  funded: number;
  status: "funded" | "partial" | "unfunded";
}

export interface PlanResult {
  monthly: { income: number; outflow: number; surplus: number; savingsRate: number | null };
  emergency: { target: number; saved: number; gap: number; monthly: number };
  investable: number;
  risk: { profile: RiskProfile; score: number | null; equityCap: number };
  goals: GoalResult[];
  totals: { required: number; funded: number; shortfall: number; spare: number };
  /** Where each month's new money goes, in rupees, after the emergency top-up. */
  monthlySplit: AssetMix;
  /** Target mix for the whole portfolio (goals weighted by today's value of their cost). */
  target: AssetMix;
  actual: ActualAllocation | null;
  /** target − actual, per class, as a fraction of the portfolio. Positive = underweight. */
  gap: AssetMix | null;
  notes: string[];
}

const PRIORITY_RANK: Record<Priority, number> = { must: 0, should: 1, nice: 2 };
const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const CLASS_NAME: Record<keyof AssetMix, string> = { equity: "equity", debt: "debt", gold: "gold" };

export function computePlan(input: PlanInput, today: Date, actual: ActualAllocation | null = null): PlanResult {
  const year = today.getUTCFullYear();
  const a = input.assumptions;

  const outflow = input.essentials + input.lifestyle + input.emis;
  const surplus = input.income - outflow;
  const monthly = { income: input.income, outflow, surplus, savingsRate: input.income > 0 ? surplus / input.income : null };

  const emergencyTarget = input.emergency.months * (input.essentials + input.emis);
  const emergencyGap = Math.max(0, emergencyTarget - input.emergency.saved);
  const emergencyMonthly = emergencyGap > 0 ? Math.min(emergencyGap / 6, Math.max(0, surplus)) : 0;
  const investable = Math.max(0, surplus - emergencyMonthly);

  const { profile, score } = riskProfile(input.risk);
  const cap = EQUITY_CAP[profile];

  const goals: GoalResult[] = input.goals.map((g) => {
    const years = Math.max(0, g.targetYear - year);
    const months = years * 12;
    const futureCost = g.costToday * (1 + (g.inflation ?? a.inflation)) ** years;
    const m = goalMix(years, cap);
    const sipFor = (s: Scenario) => {
      const rate = blendedReturn(m, shifted(a, s));
      return requiredSip(Math.max(0, futureCost - g.saved * (1 + rate) ** years), months, rate);
    };
    return {
      id: g.id,
      name: g.name,
      priority: g.priority,
      years,
      futureCost,
      mix: m,
      expectedReturn: blendedReturn(m, a),
      sip: { cautious: sipFor("cautious"), base: sipFor("base"), optimistic: sipFor("optimistic") },
      dueNow: months === 0 && futureCost > g.saved,
      funded: 0,
      status: "unfunded",
    };
  });

  // Fund by priority, then nearest date. Goals due now need a lump sum and are left to the notes.
  let left = investable;
  const order = [...goals].sort((x, y) => PRIORITY_RANK[x.priority] - PRIORITY_RANK[y.priority] || x.years - y.years);
  for (const g of order) {
    if (g.dueNow) continue;
    g.funded = Math.min(g.sip.base, left);
    left -= g.funded;
    g.status = g.sip.base === 0 || g.funded >= g.sip.base - 0.5 ? "funded" : g.funded > 0 ? "partial" : "unfunded";
  }
  const required = goals.filter((g) => !g.dueNow).reduce((s, g) => s + g.sip.base, 0);
  const funded = goals.reduce((s, g) => s + g.funded, 0);

  const monthlySplit: AssetMix = { equity: 0, debt: emergencyMonthly, gold: 0 };
  for (const g of goals) {
    monthlySplit.equity += g.funded * g.mix.equity;
    monthlySplit.debt += g.funded * g.mix.debt;
    monthlySplit.gold += g.funded * g.mix.gold;
  }

  // Portfolio target: each goal weighted by today's value of its cost; the emergency fund sits in debt.
  const weights = goals.map((g) => g.futureCost / (1 + g.expectedReturn) ** g.years);
  const totalWeight = weights.reduce((s, w) => s + w, 0) + emergencyTarget;
  const target: AssetMix =
    totalWeight > 0
      ? {
          equity: goals.reduce((s, g, i) => s + g.mix.equity * weights[i]!, 0) / totalWeight,
          gold: goals.reduce((s, g, i) => s + g.mix.gold * weights[i]!, 0) / totalWeight,
          debt: (goals.reduce((s, g, i) => s + g.mix.debt * weights[i]!, 0) + emergencyTarget) / totalWeight,
        }
      : { equity: 0, debt: 1, gold: 0 };
  const gap = actual && actual.total > 0
    ? { equity: target.equity - actual.share.equity, debt: target.debt - actual.share.debt, gold: target.gold - actual.share.gold }
    : null;

  const notes: string[] = [];
  if (surplus <= 0) notes.push(`Spending (${inr(outflow)}) is at or above income (${inr(input.income)}). Nothing is left to invest until that changes.`);
  if (emergencyGap > 0) notes.push(`Emergency fund is ${inr(emergencyGap)} short of ${input.emergency.months} months of essentials. ${inr(emergencyMonthly)}/month fills it in about ${Math.ceil(emergencyGap / Math.max(1, emergencyMonthly))} months, before goals.`);
  if (!input.insurance.health) notes.push("No health insurance: one hospital stay can undo years of saving. Cover this before investing more.");
  if (!input.insurance.term) notes.push("No term life cover. If anyone depends on your income, a term plan comes before goals.");
  for (const g of goals.filter((x) => x.dueNow)) notes.push(`${g.name} is due this year and needs a lump sum of about ${inr(g.futureCost)}, not a SIP.`);
  const shortfall = Math.max(0, required - investable);
  if (shortfall > 0.5) {
    const cut = order.filter((g) => g.status !== "funded" && !g.dueNow).map((g) => g.name);
    notes.push(`Goals need ${inr(required)}/month; ${inr(investable)} is available. Short by ${inr(shortfall)}: consider delaying or resizing ${cut.join(", ")}.`);
  }
  if (gap) {
    const under = (Object.keys(gap) as (keyof AssetMix)[]).filter((k) => gap[k] > 0.05).sort((x, y) => gap[y] - gap[x]);
    const over = (Object.keys(gap) as (keyof AssetMix)[]).filter((k) => gap[k] < -0.05);
    if (under.length && over.length) {
      notes.push(`Portfolio holds more ${over.map((k) => CLASS_NAME[k]).join(" and ")} than the plan targets. Direct new money to ${under.map((k) => CLASS_NAME[k]).join(" and ")} instead of selling: rebalancing with new money avoids tax.`);
    }
  }
  if (score === null) notes.push("Answer the five risk questions to set how much equity each goal may hold. Until then, a balanced profile is assumed.");

  return {
    monthly,
    emergency: { target: emergencyTarget, saved: input.emergency.saved, gap: emergencyGap, monthly: emergencyMonthly },
    investable,
    risk: { profile, score, equityCap: cap },
    goals,
    totals: { required, funded, shortfall, spare: Math.max(0, investable - required) },
    monthlySplit,
    target,
    actual,
    gap,
    notes,
  };
}

/** Defaults for a new plan, and the sample the public demo shows. */
export const DEFAULT_ASSUMPTIONS: PlanInput["assumptions"] = { inflation: 0.06, equity: 0.11, debt: 0.07, gold: 0.07 };

export const SAMPLE_PLAN: PlanInput = {
  version: 1,
  income: 180000,
  essentials: 70000,
  lifestyle: 25000,
  emis: 20000,
  emergency: { months: 6, saved: 350000 },
  insurance: { term: true, health: true },
  goals: [
    { id: "home", name: "Home down payment", costToday: 2500000, targetYear: new Date().getUTCFullYear() + 6, priority: "must", saved: 400000 },
    { id: "edu", name: "Child's education", costToday: 2000000, targetYear: new Date().getUTCFullYear() + 14, priority: "must", saved: 0, inflation: 0.1 },
    { id: "retire", name: "Retirement", costToday: 30000000, targetYear: new Date().getUTCFullYear() + 25, priority: "should", saved: 600000 },
    { id: "car", name: "Car", costToday: 1200000, targetYear: new Date().getUTCFullYear() + 3, priority: "nice", saved: 100000 },
  ],
  risk: [2, 3, 2, 2, 2],
  assumptions: DEFAULT_ASSUMPTIONS,
};
