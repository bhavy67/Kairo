/**
 * Parse a pasted list of tickers: one per line, comma/space/tab separated, or a
 * column copied from a spreadsheet. Accepts the forms people actually paste:
 * "NSE:INFY", "INFY-EQ", "infy", "TCS.NS". Returns unique NSE symbols in input
 * order, plus the tokens that could not be a symbol at all.
 */
export function parseSymbolList(text: string, max = 100): { symbols: string[]; invalid: string[]; truncated: boolean } {
  const seen = new Set<string>();
  const symbols: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;|]+/)) {
    const token = raw.trim();
    if (!token) continue;
    const s = token
      .toUpperCase()
      .replace(/^(NSE|BSE):/, "")
      .replace(/\.(NS|BO)$/, "")
      .replace(/-(EQ|BE)$/, "");
    if (!/^[A-Z0-9&-]{1,20}$/.test(s)) {
      invalid.push(token);
      continue;
    }
    if (!seen.has(s)) {
      seen.add(s);
      symbols.push(s);
    }
  }
  return { symbols: symbols.slice(0, max), invalid, truncated: symbols.length > max };
}
