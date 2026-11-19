import { parseCsvRecords } from "./csv.js";

/**
 * Zerodha Console tradebook (Reports → Tradebook → Equity → CSV).
 * Columns are matched by name, case-insensitively, with a few aliases, so a
 * reordered or extended export still parses; missing required columns fail loudly.
 */

export interface Trade {
  tradeId: string;
  orderId: string | null;
  exchange: string;
  symbol: string;
  isin: string;
  /** ISO date YYYY-MM-DD */
  date: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  /** ISO timestamp when present: orders same-day trades. */
  executedAt: string | null;
}

export interface TradebookParse {
  trades: Trade[];
  /** Rows dropped on purpose (derivatives, zero quantity), with the reason. */
  skipped: { row: number; reason: string }[];
}

const ALIASES: Record<string, string[]> = {
  symbol: ["symbol", "tradingsymbol", "scrip"],
  isin: ["isin"],
  date: ["trade_date", "date", "tradedate"],
  exchange: ["exchange"],
  segment: ["segment"],
  side: ["trade_type", "type", "side", "transaction_type"],
  quantity: ["quantity", "qty"],
  price: ["price", "trade_price", "rate"],
  tradeId: ["trade_id", "tradeid"],
  orderId: ["order_id", "orderid"],
  executedAt: ["order_execution_time", "execution_time", "trade_time"],
};
const REQUIRED = ["symbol", "date", "side", "quantity", "price", "tradeId"] as const;

function normaliseDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})[-/](\d{2})[-/](\d{4})/.exec(t);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export class TradebookError extends Error {}

export function parseTradebook(csv: string): TradebookParse {
  const records = parseCsvRecords(csv);
  if (records.length === 0) throw new TradebookError("The file has no rows.");
  const headers = Object.keys(records[0]!);
  const lower = new Map(headers.map((h) => [h.toLowerCase().replace(/\s+/g, "_"), h]));
  const col: Partial<Record<keyof typeof ALIASES, string>> = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const hit = names.find((n) => lower.has(n));
    if (hit) col[field] = lower.get(hit)!;
  }
  const missing = REQUIRED.filter((f) => !col[f]);
  if (missing.length) {
    throw new TradebookError(`Missing columns: ${missing.join(", ")}. Export the equity tradebook as CSV from Zerodha Console.`);
  }

  const get = (r: Record<string, string>, f: keyof typeof ALIASES) => (col[f] ? (r[col[f]!] ?? "").trim() : "");
  const trades: Trade[] = [];
  const skipped: TradebookParse["skipped"] = [];
  records.forEach((r, i) => {
    const row = i + 2; // 1-based, after the header
    const segment = get(r, "segment").toUpperCase();
    if (segment && segment !== "EQ") return skipped.push({ row, reason: `segment ${segment} (only equity is supported)` });
    const side = get(r, "side").toLowerCase();
    const quantity = Number(get(r, "quantity"));
    const price = Number(get(r, "price"));
    const date = normaliseDate(get(r, "date"));
    if (side !== "buy" && side !== "sell") throw new TradebookError(`Row ${row}: trade type "${get(r, "side")}" is not buy or sell.`);
    if (!date) throw new TradebookError(`Row ${row}: unreadable trade date "${get(r, "date")}".`);
    if (!Number.isFinite(price) || price < 0) throw new TradebookError(`Row ${row}: invalid price.`);
    if (!Number.isFinite(quantity) || quantity <= 0) return skipped.push({ row, reason: "zero quantity" });
    const executed = get(r, "executedAt");
    trades.push({
      tradeId: get(r, "tradeId"),
      orderId: get(r, "orderId") || null,
      exchange: (get(r, "exchange") || "NSE").toUpperCase(),
      symbol: get(r, "symbol").toUpperCase(),
      isin: get(r, "isin").toUpperCase(),
      date,
      side,
      quantity,
      price,
      executedAt: executed ? executed.replace(" ", "T") : null,
    });
  });
  return { trades, skipped };
}
