import { parseCsvRecords } from "./csv.js";

/**
 * Parsers for NSE's public end-of-day archive files (nsearchives.nseindia.com).
 * All prices are in rupees; all percentages are returned as fractions.
 */

export interface DailyBar {
  symbol: string;
  isin: string;
  /** ISO date YYYY-MM-DD. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Adjusted by NSE for corporate actions on the ex-date, so day change stays correct. */
  prevClose: number;
  volume: number;
  turnover: number;
}

export interface IndexBar {
  name: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  changePct: number | null;
  pe: number | null;
  pb: number | null;
}

export interface Instrument {
  symbol: string;
  isin: string;
  name: string;
  industry: string;
}

/** Equity series worth tracking: regular (EQ) and trade-for-trade (BE). */
const SERIES = new Set(["EQ", "BE"]);

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const t = s.trim();
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** DD-MM-YYYY → YYYY-MM-DD */
const dmyToIso = (s: string): string | null => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/** Full CM bhavcopy (BhavCopy_NSE_CM_0_0_0_YYYYMMDD_F_0000.csv). */
export function parseBhavcopy(csv: string): DailyBar[] {
  const out: DailyBar[] = [];
  for (const r of parseCsvRecords(csv)) {
    if (!SERIES.has(r.SctySrs ?? "")) continue;
    const open = num(r.OpnPric);
    const high = num(r.HghPric);
    const low = num(r.LwPric);
    const close = num(r.ClsPric);
    const prevClose = num(r.PrvsClsgPric);
    if (open === null || high === null || low === null || close === null || prevClose === null) continue;
    if (!r.TckrSymb || !/^\d{4}-\d{2}-\d{2}$/.test(r.TradDt ?? "")) continue;
    out.push({
      symbol: r.TckrSymb,
      isin: r.ISIN ?? "",
      date: r.TradDt!,
      open,
      high,
      low,
      close,
      prevClose,
      volume: num(r.TtlTradgVol) ?? 0,
      turnover: num(r.TtlTrfVal) ?? 0,
    });
  }
  return out;
}

/** Daily index closes (ind_close_all_DDMMYYYY.csv). */
export function parseIndexClose(csv: string): IndexBar[] {
  const out: IndexBar[] = [];
  for (const r of parseCsvRecords(csv)) {
    const name = r["Index Name"];
    const date = dmyToIso(r["Index Date"] ?? "");
    const close = num(r["Closing Index Value"]);
    if (!name || !date || close === null) continue;
    const pct = num(r["Change(%)"]);
    out.push({
      name,
      date,
      open: num(r["Open Index Value"]),
      high: num(r["High Index Value"]),
      low: num(r["Low Index Value"]),
      close,
      changePct: pct === null ? null : pct / 100,
      pe: num(r["P/E"]),
      pb: num(r["P/B"]),
    });
  }
  return out;
}

/** Index constituent list (e.g. ind_nifty500list.csv). */
export function parseConstituents(csv: string): Instrument[] {
  return parseCsvRecords(csv)
    .filter((r) => r.Symbol && r["ISIN Code"])
    .map((r) => ({
      symbol: r.Symbol!,
      isin: r["ISIN Code"]!,
      name: r["Company Name"] ?? r.Symbol!,
      industry: r.Industry || "Unclassified",
    }));
}

/** YYYY-MM-DD → the YYYYMMDD and DDMMYYYY forms NSE uses in file names. */
export function nseDateParts(iso: string): { ymd: string; dmy: string } {
  const [y, m, d] = iso.split("-");
  return { ymd: `${y}${m}${d}`, dmy: `${d}${m}${y}` };
}
