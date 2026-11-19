/**
 * Parser for AMFI's daily NAV file (https://www.amfiindia.com/spages/NAVAll.txt).
 *
 * The file is semicolon-separated with interleaved section headers
 * (fund house / scheme category lines) that have no semicolons:
 *   Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
 */

export interface NavRecord {
  schemeCode: string;
  isins: string[];
  name: string;
  nav: number;
  /** ISO date YYYY-MM-DD. */
  date: string;
}

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function toIsoDate(amfiDate: string): string | null {
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(amfiDate.trim());
  const month = m && MONTHS[m[2]!];
  return m && month ? `${m[3]}-${month}-${m[1]}` : null;
}

const isIsin = (s: string) => /^IN[A-Z0-9]{10}$/.test(s);

export function parseAmfiNav(text: string): NavRecord[] {
  const out: NavRecord[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const cols = raw.split(";");
    if (cols.length < 6) continue;
    const [code, isin1, isin2, name, navStr, dateStr] = cols.map((c) => c.trim());
    if (!code || !/^\d+$/.test(code)) continue; // header row
    const nav = Number(navStr);
    const date = toIsoDate(dateStr ?? "");
    if (!Number.isFinite(nav) || nav <= 0 || !date) continue; // "N.A." NAVs
    out.push({
      schemeCode: code,
      isins: [isin1 ?? "", isin2 ?? ""].filter(isIsin),
      name: name ?? "",
      nav,
      date,
    });
  }
  return out;
}

/** Index by ISIN for O(1) lookup; one scheme can carry two ISINs. */
export function indexByIsin(records: readonly NavRecord[]): Map<string, NavRecord> {
  const map = new Map<string, NavRecord>();
  for (const r of records) for (const isin of r.isins) map.set(isin, r);
  return map;
}
