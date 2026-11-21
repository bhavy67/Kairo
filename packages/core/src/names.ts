/**
 * The name shown in the app.
 *
 * Brokers give the legal name, and legal names come in more than one order:
 * "BHAVY RAJESHBHAI LADANI" (first, father's, surname) or "LADANI BHAVY
 * RAJESHBHAI" (surname first). Nothing the broker sends says which word is the
 * first name: Kite's "short name" is sometimes the first name and sometimes the
 * surname. So Kairo does not guess. The name the user chose wins; without one,
 * the full legal name is shown, title-cased. A long name is better than a wrong one.
 */
export function displayName(legal: string, chosen?: string | null): string {
  const pick = chosen?.trim().replace(/\s+/g, " ");
  if (pick) return pick;
  return legal.trim().split(/\s+/).filter(Boolean).map(titleCase).join(" ");
}

function titleCase(w: string): string {
  return w.toLowerCase().replace(/(^|[-'.\s])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}
