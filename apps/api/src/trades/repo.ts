import { actionParts, type Action, type Trade } from "@kairo/core";
import type { Db } from "../db/db.js";

export class TradesRepo {
  constructor(private readonly db: Db) {}

  /** Insert trades; rows already present (same exchange, date, symbol, trade id) are skipped. */
  async insert(trades: Trade[], filename: string | null, skipped: number): Promise<{ inserted: number; duplicates: number }> {
    const col = <K extends keyof Trade>(k: K) => trades.map((t) => t[k]);
    const rows = trades.length
      ? await this.db.query(
          `insert into trades (trade_id, order_id, exchange, symbol, isin, trade_date, side, quantity, price, executed_at)
           select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::date[],
                                $7::text[], $8::float8[], $9::float8[], $10::text[])
           on conflict do nothing returning id`,
          [col("tradeId"), col("orderId"), col("exchange"), col("symbol"), col("isin"), col("date"), col("side"), col("quantity"), col("price"), col("executedAt")],
        )
      : [];
    await this.db.query("insert into trade_imports (filename, rows, inserted, skipped) values ($1, $2, $3, $4)", [
      filename,
      trades.length,
      rows.length,
      skipped,
    ]);
    return { inserted: rows.length, duplicates: trades.length - rows.length };
  }

  all(): Promise<Trade[]> {
    return this.db.query<Trade>(
      `select trade_id as "tradeId", order_id as "orderId", exchange, symbol, isin, trade_date::text as date,
              side, quantity, price, executed_at as "executedAt"
       from trades order by trade_date, executed_at nulls first, id`,
    );
  }

  async clear(): Promise<number> {
    return (await this.db.query("delete from trades returning id")).length;
  }

  /**
   * ISIN → NSE symbol, so a stock bought on BSE and sold on NSE is one position.
   * Sources, in order: NSE trades in the file, the Nifty 500 list, recent bhavcopies
   * (which also catch the new ISIN a stock gets after a face-value split).
   */
  async symbolsForIsins(isins: string[], fromTrades: Map<string, string>): Promise<Map<string, string>> {
    const map = new Map(fromTrades);
    const missing = isins.filter((i) => i && !map.has(i));
    if (missing.length) {
      for (const r of await this.db.query<{ isin: string; symbol: string }>("select isin, symbol from instruments where isin = any($1::text[])", [missing])) {
        map.set(r.isin, r.symbol);
      }
    }
    const still = isins.filter((i) => i && !map.has(i));
    if (still.length) {
      const rows = await this.db.query<{ isin: string; symbol: string }>(
        `select distinct on (isin) isin, symbol from daily_bars
         where isin = any($1::text[]) and date > current_date - 400 order by isin, date desc`,
        [still],
      );
      for (const r of rows) map.set(r.isin, r.symbol);
    }
    return map;
  }

  async actions(symbols: string[]): Promise<Action[]> {
    if (symbols.length === 0) return [];
    const rows = await this.db.query<{ symbol: string; ex_date: string; purpose: string }>(
      "select symbol, ex_date::text as ex_date, purpose from corporate_actions where symbol = any($1::text[]) and ratio is not null",
      [symbols],
    );
    return rows.map((r) => ({ key: r.symbol, exDate: r.ex_date, ...actionParts(r.purpose) }));
  }

  /** Latest close per symbol, for open lots the broker no longer reports. */
  async lastCloses(symbols: string[]): Promise<Map<string, number>> {
    if (symbols.length === 0) return new Map();
    const rows = await this.db.query<{ symbol: string; close: number }>(
      `select distinct on (symbol) symbol, close from daily_bars
       where symbol = any($1::text[]) and date > current_date - 30 order by symbol, date desc`,
      [symbols],
    );
    return new Map(rows.map((r) => [r.symbol, r.close]));
  }
}
