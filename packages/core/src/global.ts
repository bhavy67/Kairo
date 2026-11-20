import { parseCsvRecords } from "./csv.js";

/**
 * Global markets from free, keyless public sources:
 * - FRED (St. Louis Fed): US indices, Nikkei 225, US 10-year yield, Brent.
 * - Frankfurter (ECB reference rates): the rupee against major currencies.
 * FTSE, DAX and Hang Seng are licensed and not in these feeds; they are listed
 * as unavailable rather than approximated with ETF proxies.
 */

export type GlobalKind = "index" | "yield" | "commodity" | "fx";
export type GlobalGroup = "United States" | "Asia" | "Gold & silver" | "Rates & commodities" | "Rupee";

export interface GlobalSeries {
  id: string;
  label: string;
  group: GlobalGroup;
  kind: GlobalKind;
  source: "fred" | "ecb" | "nse";
  /** FRED series id, the currency code for ECB rates against INR, or an NSE symbol. */
  code: string;
  unit: "" | "%" | "$" | "₹";
}

export const GLOBAL_SERIES: GlobalSeries[] = [
  { id: "sp500", label: "S&P 500", group: "United States", kind: "index", source: "fred", code: "SP500", unit: "" },
  { id: "nasdaq", label: "Nasdaq Composite", group: "United States", kind: "index", source: "fred", code: "NASDAQCOM", unit: "" },
  { id: "dow", label: "Dow Jones", group: "United States", kind: "index", source: "fred", code: "DJIA", unit: "" },
  { id: "nikkei", label: "Nikkei 225", group: "Asia", kind: "index", source: "fred", code: "NIKKEI225", unit: "" },
  { id: "us10y", label: "US 10-year yield", group: "Rates & commodities", kind: "yield", source: "fred", code: "DGS10", unit: "%" },
  { id: "brent", label: "Brent crude", group: "Rates & commodities", kind: "commodity", source: "fred", code: "DCOILBRENTEU", unit: "$" },
  { id: "usdinr", label: "USD / INR", group: "Rupee", kind: "fx", source: "ecb", code: "USD", unit: "₹" },
  { id: "eurinr", label: "EUR / INR", group: "Rupee", kind: "fx", source: "ecb", code: "EUR", unit: "₹" },
  { id: "gbpinr", label: "GBP / INR", group: "Rupee", kind: "fx", source: "ecb", code: "GBP", unit: "₹" },
  { id: "jpyinr", label: "JPY / INR (per 100)", group: "Rupee", kind: "fx", source: "ecb", code: "JPY", unit: "₹" },
];

export const UNAVAILABLE = ["FTSE 100", "DAX", "Hang Seng", "Sensex"];

/**
 * Gold and silver as an Indian investor holds them: the most-traded NSE ETFs.
 * Their prices come from the daily NSE file Kairo already imports.
 */
export const METAL_ETFS = [
  { id: "goldbees", symbol: "GOLDBEES", label: "Gold ETF · GOLDBEES" },
  { id: "silverbees", symbol: "SILVERBEES", label: "Silver ETF · SILVERBEES" },
] as const;

export interface Point {
  date: string;
  value: number;
}

/** FRED fredgraph.csv: "observation_date,<ID>" (older exports use "DATE"); missing values are "." or empty. */
export function parseFredCsv(csv: string): Point[] {
  const out: Point[] = [];
  for (const r of parseCsvRecords(csv)) {
    const date = r.observation_date ?? r.DATE ?? "";
    const key = Object.keys(r).find((k) => k !== "observation_date" && k !== "DATE") ?? "";
    const raw = r[key] ?? "";
    const value = Number(raw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || raw === "" || raw === "." || !Number.isFinite(value)) continue;
    out.push({ date, value });
  }
  return out;
}

/**
 * Frankfurter time series with base INR: { rates: { "2026-11-19": { USD: 0.0107, ... } } }.
 * Inverted to rupees per unit of each currency (JPY per 100 yen, as RBI quotes it).
 */
export function parseEcbRates(json: unknown, currencies: string[]): Map<string, Point[]> {
  const out = new Map<string, Point[]>(currencies.map((c) => [c, []]));
  const rates = (json as { rates?: Record<string, Record<string, number>> } | null)?.rates ?? {};
  for (const date of Object.keys(rates).sort()) {
    for (const c of currencies) {
      const perInr = rates[date]?.[c];
      if (!perInr || perInr <= 0) continue;
      out.get(c)!.push({ date, value: (c === "JPY" ? 100 : 1) / perInr });
    }
  }
  return out;
}

export interface GlobalQuote {
  id: string;
  label: string;
  group: GlobalGroup;
  kind: GlobalKind;
  unit: GlobalSeries["unit"];
  date: string;
  value: number;
  /** Change vs the previous observation: a fraction, or percentage points for yields. */
  change: number | null;
  history: Point[];
}

export function toQuote(s: GlobalSeries, points: Point[]): GlobalQuote | null {
  const last = points.at(-1);
  if (!last) return null;
  const prev = points.at(-2);
  const change = !prev ? null : s.kind === "yield" ? last.value - prev.value : last.value / prev.value - 1;
  return { id: s.id, label: s.label, group: s.group, kind: s.kind, unit: s.unit, date: last.date, value: last.value, change, history: points.slice(-60) };
}

const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v * 100).toFixed(1)}%`;

/**
 * One plain sentence of overnight cues for the Indian open. It describes what
 * happened; it does not predict what Indian markets will do.
 */
export function overnightCues(quotes: GlobalQuote[]): string | null {
  const q = (id: string) => quotes.find((x) => x.id === id);
  const parts: string[] = [];
  const sp = q("sp500");
  const nq = q("nasdaq");
  if (sp?.change != null) {
    // A direction word only when the broad index and the tech index agree.
    const moves = [sp.change, nq?.change].filter((c): c is number => c != null);
    const dir = moves.every((c) => c > 0.002) ? "rose" : moves.every((c) => c < -0.002) ? "fell" : moves.every((c) => Math.abs(c) <= 0.002) ? "were flat" : "were mixed";
    parts.push(`US stocks ${dir}: S&P 500 ${pct(sp.change)}${nq?.change != null ? `, Nasdaq ${pct(nq.change)}` : ""}`);
  }
  const nk = q("nikkei");
  if (nk?.change != null) parts.push(`Nikkei ${pct(nk.change)}`);
  const brent = q("brent");
  if (brent) {
    const moved = brent.change != null && Math.abs(brent.change) >= 0.0005;
    parts.push(`Brent $${brent.value.toFixed(1)}${moved ? ` (${pct(brent.change!)})` : ""}`);
  }
  const usd = q("usdinr");
  if (usd) {
    const move = usd.change == null || Math.abs(usd.change) < 0.0005 ? "" : usd.change > 0 ? ", rupee weaker" : ", rupee stronger";
    parts.push(`₹${usd.value.toFixed(2)} per dollar${move}`);
  }
  return parts.length ? `${parts.join(". ")}.` : null;
}
