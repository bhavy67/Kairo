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

export interface CorporateAction {
  symbol: string;
  exDate: string;
  purpose: string;
  /**
   * Shares after ÷ shares before. Prices before the ex-date are divided by it.
   * Bonus 1:1 → 2. Split ₹10 → ₹2 → 5. Consolidation ₹1 → ₹10 → 0.1.
   * Null when the action does not change the share count, or the text is not understood.
   */
  ratio: number | null;
}

const MONTH_NUM: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

function anyDateToIso(s: string): string | null {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(t);
  const mon = m && MONTH_NUM[m[2]!.toUpperCase()];
  return m && mon ? `${m[3]}-${mon}-${m[1]}` : dmyToIso(t);
}

/**
 * Share-count ratio implied by a corporate-action purpose, or null when the
 * action does not change the share count (dividends, AGMs, interest).
 * Rights issues are ignored: their price effect depends on the subscription price.
 */
export function actionRatio(purpose: string): number | null {
  const p = purpose.toUpperCase();
  let ratio = 1;
  const bonus = /BONUS\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/.exec(p);
  if (bonus) ratio *= (Number(bonus[1]) + Number(bonus[2])) / Number(bonus[2]);
  // NSE abbreviates freely: "FACE VALUE SPLIT … FROM RS 10 TO RS 2", "FV SPLT FRM RS 5 TO RE 1", "FVSPLT FRM RS10 TO RE1".
  if (/SPLI?T|SUB-?DIVISION|CONSOLIDAT/.test(p)) {
    const fv = /FRO?M\s*(?:RS|RE|INR|₹)?\.?\s*(\d+(?:\.\d+)?)\D*?TO\s*(?:RS|RE|INR|₹)?\.?\s*(\d+(?:\.\d+)?)/.exec(p);
    if (fv && Number(fv[2]) > 0) ratio *= Number(fv[1]) / Number(fv[2]);
  }
  return ratio === 1 || !Number.isFinite(ratio) || ratio <= 0 ? null : ratio;
}

/**
 * Every equity-series action from the PR archive's bc<DDMMYYYY>.csv, one row per
 * symbol and ex-date (purposes on the same day are joined). Actions the parser
 * does not understand are kept with ratio null: the raw purpose is stored so a
 * parser fix can be applied to history without re-downloading anything.
 */
export function parseCorporateActions(csv: string): CorporateAction[] {
  const seen = new Map<string, Set<string>>();
  for (const r of parseCsvRecords(csv)) {
    if (!SERIES.has(r.SERIES ?? "") || !r.SYMBOL || !r.PURPOSE) continue;
    const exDate = anyDateToIso(r.EX_DT ?? "");
    if (!exDate) continue;
    const key = `${r.SYMBOL}|${exDate}`;
    seen.set(key, (seen.get(key) ?? new Set()).add(r.PURPOSE.trim()));
  }
  return [...seen].map(([key, purposes]) => {
    const [symbol, exDate] = key.split("|") as [string, string];
    const purpose = [...purposes].join(" / ");
    return { symbol, exDate, purpose, ratio: actionRatio(purpose) };
  });
}

/**
 * The two share-count effects of an action, kept apart because Indian tax treats
 * them differently: a split rescales existing lots (same date, cost spread);
 * bonus shares are a new lot with zero cost, acquired on the allotment date.
 */
export function actionParts(purpose: string): { split: number | null; bonus: number | null } {
  const p = purpose.toUpperCase();
  const b = /BONUS\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/.exec(p);
  const bonus = b ? (Number(b[1]) + Number(b[2])) / Number(b[2]) : null;
  let split: number | null = null;
  if (/SPLI?T|SUB-?DIVISION|CONSOLIDAT/.test(p)) {
    const fv = /FRO?M\s*(?:RS|RE|INR|₹)?\.?\s*(\d+(?:\.\d+)?)\D*?TO\s*(?:RS|RE|INR|₹)?\.?\s*(\d+(?:\.\d+)?)/.exec(p);
    if (fv && Number(fv[2]) > 0) split = Number(fv[1]) / Number(fv[2]);
  }
  return { split: split === 1 ? null : split, bonus: bonus === 1 ? null : bonus };
}
