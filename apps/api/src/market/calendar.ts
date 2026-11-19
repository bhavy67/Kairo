const IST_OFFSET_MS = 330 * 60_000;

/** Calendar date in India for an instant, as YYYY-MM-DD. */
export function istDate(now: number): string {
  return new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Minutes since midnight IST. */
export function istMinutes(now: number): number {
  const d = new Date(now + IST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function isWeekend(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** NSE usually publishes the bhavcopy by ~18:00 IST; we wait a little longer. */
export const EOD_READY_MINUTES = 18 * 60 + 30;
