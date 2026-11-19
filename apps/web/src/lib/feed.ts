import type { Breadth, HoldingView, IndexQuote } from "@kairo/core";
import type { AlertEvent, PresetResult } from "./api";

export type FeedItem = {
  id: string;
  tone: "gain" | "loss" | "neutral";
  symbol?: string;
  text: string;
  meta: string;
};

const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(1)}%`;

/** One honest sentence about the session, from breadth. No forecasting. */
export function marketMood(b: Breadth | null, nifty: IndexQuote | undefined, vix: IndexQuote | undefined): string | null {
  if (!b) return null;
  const ratio = b.declines ? b.advances / b.declines : Infinity;
  const tone = ratio >= 1.5 ? "Broad buying" : ratio <= 0.67 ? "Broad selling" : "Mixed session";
  const parts = [`${tone}: ${b.advances} up, ${b.declines} down in the Nifty 500`];
  if (nifty?.changePct != null) parts.push(`Nifty 50 ${pct(nifty.changePct)}`);
  if (vix) parts.push(`VIX ${vix.close.toFixed(1)}`);
  return `${parts.join(" · ")}.`;
}

/**
 * What changed today, most actionable first: your alerts, then your holdings'
 * big moves, then your holdings showing up in today's screens. Capped so the
 * feed stays a glance, not a report.
 */
export function buildFeed(input: {
  asOf: string | null;
  holdings: HoldingView[];
  events: AlertEvent[];
  presets: PresetResult[];
  moveThreshold?: number;
  limit?: number;
}): FeedItem[] {
  const { asOf, holdings, events, presets, moveThreshold = 0.02, limit = 8 } = input;
  const items: FeedItem[] = [];

  for (const e of events.filter((e) => !asOf || e.date === asOf)) {
    items.push({ id: `a${e.id}`, tone: "neutral", symbol: e.symbol, text: e.message, meta: e.source === "screen" ? "Screen alert" : "Alert" });
  }

  const movers = holdings
    .filter((h) => h.dayChangePct !== null && Math.abs(h.dayChangePct) >= moveThreshold)
    .sort((a, b) => Math.abs(b.dayChangePct!) - Math.abs(a.dayChangePct!));
  for (const h of movers) {
    items.push({
      id: `m${h.symbol}`,
      tone: h.dayChangePct! > 0 ? "gain" : "loss",
      symbol: h.symbol,
      text: `${h.symbol} ${pct(h.dayChangePct!)} today`,
      meta: `Holding · ${h.dayChange >= 0 ? "+" : "−"}₹${Math.abs(Math.round(h.dayChange)).toLocaleString("en-IN")}`,
    });
  }

  const held = new Set(holdings.map((h) => h.symbol));
  for (const p of presets) {
    for (const r of p.rows.filter((r) => held.has(r.symbol))) {
      items.push({ id: `p${p.id}${r.symbol}`, tone: "neutral", symbol: r.symbol, text: `${r.symbol} is in “${p.name}”`, meta: "Screen" });
    }
  }
  return items.slice(0, limit);
}
