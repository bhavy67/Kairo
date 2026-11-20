const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
const pct = new Intl.NumberFormat("en-IN", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct0 = new Intl.NumberFormat("en-IN", { style: "percent", maximumFractionDigits: 0 });

export const money = (v: number) => inr.format(v);
export const money2 = (v: number) => inr2.format(v);
export const qty = (v: number) => num.format(v);
export const percent = (v: number | null) => (v === null ? "–" : pct.format(v).replace("-", "−"));
export const share = (v: number) => pct0.format(v);
export const signed = (v: number, f: (n: number) => string) => (v > 0 ? `+${f(v)}` : v < 0 ? `−${f(-v)}` : f(0));

const IST_OFFSET_MIN = 330;

/** NSE cash session, 09:15–15:30 IST, Mon–Fri. Holidays are not modelled yet. */
export function isMarketOpen(now = new Date()): boolean {
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  const day = ist.getUTCDay();
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return day >= 1 && day <= 5 && mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

/** Milliseconds until the next 09:15 IST open, if it is later today; otherwise null. */
export function msToOpenToday(now = new Date()): number | null {
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  const day = ist.getUTCDay();
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes() + ist.getUTCSeconds() / 60;
  if (day < 1 || day > 5 || mins >= 9 * 60 + 15) return null;
  return (9 * 60 + 15 - mins) * 60_000;
}

export const timeIst = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

const idx = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
export const level = (v: number) => idx.format(v);
export const big = (v: number) => compact.format(v);
export const ratio = (v: number | null) => (v === null ? "–" : `${v.toFixed(1)}×`);

export const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
