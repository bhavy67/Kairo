import { describe, expect, it } from "vitest";
import { financialYear, isLongTerm, matchLots, summarizeTrades, type KeyedTrade } from "./lots.js";
import { actionParts } from "./nse.js";
import { parseTradebook, TradebookError } from "./tradebook.js";

let n = 0;
const t = (o: Partial<KeyedTrade> & Pick<KeyedTrade, "date" | "side" | "quantity" | "price">): KeyedTrade => ({
  tradeId: String(++n), orderId: null, exchange: "NSE", symbol: "ABC", isin: "INE000000AB1", executedAt: null, key: "ABC", ...o,
});

describe("tax helpers", () => {
  it("assigns Indian financial years", () => {
    expect(financialYear("2026-03-31")).toBe("FY 2025-26");
    expect(financialYear("2026-04-01")).toBe("FY 2026-27");
  });
  it("needs more than 12 months for long term", () => {
    expect(isLongTerm("2025-03-10", "2026-03-10")).toBe(false);
    expect(isLongTerm("2025-03-10", "2026-03-11")).toBe(true);
  });
});

describe("matchLots", () => {
  it("closes the oldest lots first and classifies the holding period", () => {
    const r = matchLots([
      t({ date: "2024-01-10", side: "buy", quantity: 10, price: 100 }),
      t({ date: "2025-06-01", side: "buy", quantity: 10, price: 200 }),
      t({ date: "2025-09-01", side: "sell", quantity: 15, price: 300 }),
    ]);
    expect(r.realized.map((x) => [x.buyDate, x.quantity, x.pnl, x.term])).toEqual([
      ["2024-01-10", 10, 2000, "long"],
      ["2025-06-01", 5, 500, "short"],
    ]);
    expect(r.lots).toEqual([{ key: "ABC", buyDate: "2025-06-01", quantity: 5, cost: 200, source: "trade" }]);
  });

  it("nets same-day buys and sells as intraday before touching older lots", () => {
    const r = matchLots([
      t({ date: "2025-01-01", side: "buy", quantity: 10, price: 100 }),
      t({ date: "2025-02-01", side: "buy", quantity: 5, price: 120 }),
      t({ date: "2025-02-01", side: "sell", quantity: 8, price: 130 }),
    ]);
    expect(r.realized.map((x) => [x.term, x.quantity, x.buyPrice])).toEqual([
      ["intraday", 5, 120],
      ["short", 3, 100],
    ]);
  });

  it("matches BSE and NSE trades of one stock through the shared key", () => {
    const r = matchLots([
      t({ date: "2025-01-01", side: "buy", quantity: 10, price: 100, exchange: "BSE", symbol: "500123" }),
      t({ date: "2025-03-01", side: "sell", quantity: 10, price: 110 }),
    ]);
    expect(r.unmatched).toEqual([]);
    expect(r.realized[0]!.pnl).toBe(100);
  });

  it("rescales lots on a split and adds zero-cost lots on a bonus", () => {
    const trades = [t({ date: "2024-01-01", side: "buy", quantity: 10, price: 1000 })];
    const r = matchLots(trades, [
      { key: "ABC", exDate: "2024-06-01", split: 5, bonus: null },
      { key: "ABC", exDate: "2025-02-01", split: null, bonus: 2 },
    ]);
    expect(r.lots).toEqual([
      { key: "ABC", buyDate: "2024-01-01", quantity: 50, cost: 200, source: "trade" }, // split keeps date, spreads cost
      { key: "ABC", buyDate: "2025-02-01", quantity: 50, cost: 0, source: "bonus" }, // bonus: new zero-cost lot
    ]);
    // Selling 60 later: the 50 split lot is long-term, then 10 bonus shares are short-term at zero cost.
    const sold = matchLots([...trades, t({ date: "2025-05-01", side: "sell", quantity: 60, price: 150 })], [
      { key: "ABC", exDate: "2024-06-01", split: 5, bonus: null },
      { key: "ABC", exDate: "2025-02-01", split: null, bonus: 2 },
    ]);
    expect(sold.realized.map((x) => [x.quantity, x.term, x.pnl])).toEqual([
      [50, "long", -2500],
      [10, "short", 1500],
    ]);
  });

  it("reports sales with no recorded purchase instead of inventing a cost", () => {
    const r = matchLots([t({ date: "2025-01-01", side: "sell", quantity: 4, price: 50 })]);
    expect(r.unmatched).toEqual([{ key: "ABC", date: "2025-01-01", quantity: 4 }]);
    expect(r.realized).toEqual([]);
  });
});

describe("summarizeTrades", () => {
  it("values open lots, groups gains by FY, computes XIRR and reconciles with the broker", () => {
    const trades = [
      t({ date: "2025-01-01", side: "buy", quantity: 10, price: 100 }),
      t({ date: "2025-07-01", side: "sell", quantity: 4, price: 150 }),
      t({ date: "2025-01-01", side: "buy", quantity: 5, price: 10, key: "XYZ", symbol: "XYZ" }),
    ];
    const s = summarizeTrades(trades, matchLots(trades), new Map([["ABC", 200], ["XYZ", 10]]), new Map([["ABC", 6], ["XYZ", 7]]), "2026-01-01");
    expect(s.coverage).toEqual({ from: "2025-01-01", to: "2025-07-01", trades: 3 });
    expect(s.realized).toBe(200);
    expect(s.byFy).toEqual([{ fy: "FY 2025-26", short: 200, long: 0, intraday: 0 }]);
    expect(s.unrealized).toBe(600); // 6 × (200 − 100)
    expect(s.positions.find((p) => p.key === "ABC")!.xirr).toBeGreaterThan(0.5);
    expect(s.mismatches).toEqual([{ key: "XYZ", tradebook: 5, broker: 7 }]);
  });
});

describe("parseTradebook", () => {
  const header = "symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time";
  it("parses a Console export and skips derivatives", () => {
    const csv = `${header}
INFY,INE009A01021,2025-03-04,NSE,EQ,EQ,buy,false,10.000000,1650.500000,1001,9001,2025-03-04T09:20:11
NIFTY25MARFUT,,2025-03-04,NSE,FO,,sell,false,75,22000,1002,9002,2025-03-04T10:00:00
`;
    const { trades, skipped } = parseTradebook(csv);
    expect(trades).toEqual([
      { tradeId: "1001", orderId: "9001", exchange: "NSE", symbol: "INFY", isin: "INE009A01021", date: "2025-03-04", side: "buy", quantity: 10, price: 1650.5, executedAt: "2025-03-04T09:20:11" },
    ]);
    expect(skipped).toEqual([{ row: 3, reason: "segment FO (only equity is supported)" }]);
  });
  it("names missing columns", () => {
    expect(() => parseTradebook("symbol,price\nINFY,1\n")).toThrow(TradebookError);
    expect(() => parseTradebook("symbol,price\nINFY,1\n")).toThrow(/trade_id|tradeId|date/);
  });
});

it("separates split and bonus parts of a combined action", () => {
  expect(actionParts("FV SPLT FRM RS 2 TO RE 1 / BONUS 1:2")).toEqual({ split: 2, bonus: 1.5 });
  expect(actionParts("INTERIM DIVIDEND")).toEqual({ split: null, bonus: null });
});
