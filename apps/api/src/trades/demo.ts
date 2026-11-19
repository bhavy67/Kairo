import type { Trade } from "@kairo/core";

/**
 * A small tradebook consistent with the demo portfolio: the open lots add up to
 * the demo holdings, plus a few closed positions (a long-term gain, a short-term
 * loss, an intraday round trip) so the Returns page has something to show.
 */
const rows: [string, string, "buy" | "sell", number, number][] = [
  ["HDFCBANK", "2024-02-12", "buy", 25, 1430],
  ["HDFCBANK", "2025-01-20", "buy", 15, 1670],
  ["INFY", "2024-06-03", "buy", 20, 1380],
  ["INFY", "2025-04-07", "buy", 15, 1450],
  ["RELIANCE", "2024-03-15", "buy", 25, 2380],
  ["ITC", "2023-11-08", "buy", 70, 330],
  ["ITC", "2024-08-19", "buy", 50, 358.8],
  ["TITAN", "2025-02-10", "buy", 12, 3150],
  ["LT", "2024-09-23", "buy", 15, 2890],
  ["ASIANPAINT", "2023-12-04", "buy", 10, 3180],
  ["ASIANPAINT", "2025-02-14", "sell", 10, 2290],
  ["TATAPOWER", "2023-10-16", "buy", 100, 248],
  ["TATAPOWER", "2025-06-18", "sell", 100, 402],
  ["SBIN", "2025-08-05", "buy", 50, 801],
  ["SBIN", "2025-08-05", "sell", 50, 809.5],
];

const ISIN: Record<string, string> = {
  HDFCBANK: "INE040A01034", INFY: "INE009A01021", RELIANCE: "INE002A01018", ITC: "INE154A01025",
  TITAN: "INE280A01028", LT: "INE018A01030", ASIANPAINT: "INE021A01026", TATAPOWER: "INE245A01021", SBIN: "INE062A01020",
};

export const DEMO_TRADES: Trade[] = rows.map(([symbol, date, side, quantity, price], i) => ({
  tradeId: `DEMO${i + 1}`,
  orderId: null,
  exchange: "NSE",
  symbol,
  isin: ISIN[symbol]!,
  date,
  side,
  quantity,
  price,
  executedAt: `${date}T${side === "buy" ? "09:30" : "14:45"}:00`,
}));
