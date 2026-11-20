/**
 * Display name from a broker's legal name, without the father's name.
 *
 * Legal names come in more than one order: "BHAVY RAJESHBHAI LADANI" (first,
 * father's, surname) and "LADANI BHAVY RAJESHBHAI" (surname first, common in
 * Gujarat and in government records). Word position alone cannot tell them
 * apart, so the broker's short name (the first name) is the anchor:
 * - surname-first: the surname is the word before the first name;
 * - first-name-first: the surname is the last word.
 * Without a short name that matches a word, the full name is shown unchanged:
 * a long name is better than a wrong one.
 */
export function displayName(legal: string, short?: string | null): string {
  const words = legal.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return titleCase(short ?? "");
  const first = (short ?? "").trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  const at = first ? words.findIndex((w) => w.toUpperCase() === first) : -1;
  if (at === -1 || words.length < 3) return words.map(titleCase).join(" ");
  const surname = at > 0 ? words[at - 1]! : words.at(-1)!;
  return `${titleCase(words[at]!)} ${titleCase(surname)}`;
}

function titleCase(w: string): string {
  return w.toLowerCase().replace(/(^|[-'.\s])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}
