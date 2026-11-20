/**
 * Display name from a broker's legal name. Indian legal names commonly read
 * "FIRST FATHER'S-NAME SURNAME"; for the UI we keep the first and last words
 * and title-case them: "BHAVY RAJESHKUMAR LADANI" -> "Bhavy Ladani".
 * One- and two-word names are only re-cased.
 */
export function displayName(legal: string): string {
  const words = legal.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const picked = words.length > 2 ? [words[0]!, words.at(-1)!] : words;
  return picked
    .map((w) => w.toLowerCase().replace(/(^|[-'.])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase()))
    .join(" ");
}
