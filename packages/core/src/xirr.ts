import type { Cashflow } from "./types.js";

const DAY_MS = 86_400_000;
const YEAR_DAYS = 365;

/**
 * Annualised internal rate of return for irregular cashflows (Excel XIRR semantics).
 *
 * Newton-Raphson converges fast from a sane guess but can diverge or jump below -100%
 * on awkward cashflows, so we fall back to bisection, which is slow but guaranteed
 * once a sign change is bracketed.
 *
 * Returns null when no rate exists (all flows share one sign) or none is found.
 */
export function xirr(flows: readonly Cashflow[], guess = 0.1): number | null {
  if (flows.length < 2) return null;
  const hasNeg = flows.some((f) => f.amount < 0);
  const hasPos = flows.some((f) => f.amount > 0);
  if (!hasNeg || !hasPos) return null;

  const t0 = Math.min(...flows.map((f) => f.date.getTime()));
  const years = flows.map((f) => (f.date.getTime() - t0) / DAY_MS / YEAR_DAYS);

  const npv = (r: number) => flows.reduce((s, f, i) => s + f.amount / (1 + r) ** years[i]!, 0);
  const dnpv = (r: number) =>
    flows.reduce((s, f, i) => s - (years[i]! * f.amount) / (1 + r) ** (years[i]! + 1), 0);

  let r = guess;
  for (let i = 0; i < 50; i++) {
    const f = npv(r);
    const d = dnpv(r);
    if (!Number.isFinite(f) || !Number.isFinite(d) || d === 0) break;
    const next = r - f / d;
    if (next <= -1) break;
    if (Math.abs(next - r) < 1e-10) return next;
    r = next;
  }

  let lo = -0.9999;
  let hi = 10;
  let fLo = npv(lo);
  if (fLo * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-9 || hi - lo < 1e-12) return mid;
    if (fLo * fMid < 0) hi = mid;
    else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}
