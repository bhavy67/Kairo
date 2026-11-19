import type { Exchange, Holding } from "@kairo/core";
import type { KiteClient } from "../kite/client.js";
import type { PortfolioProvider } from "./types.js";

const exchange = (e: string): Exchange => (e === "BSE" ? "BSE" : "NSE");

export function kiteProvider(client: KiteClient, token: string): PortfolioProvider {
  return {
    async profile() {
      const p = await client.profile(token);
      return { userId: p.user_id, name: p.user_name, broker: p.broker };
    },
    async funds() {
      const m = await client.margins(token);
      return { available: m.equity.net, used: m.equity.utilised.debits };
    },
    async holdings() {
      const rows = await client.holdings(token);
      return rows.map(
        (r): Holding => ({
          symbol: r.tradingsymbol,
          exchange: exchange(r.exchange),
          isin: r.isin,
          // Shares bought yesterday sit in t1_quantity until settlement; Kite's own UI counts them.
          quantity: r.quantity + r.t1_quantity,
          averagePrice: r.average_price,
          lastPrice: r.last_price,
          previousClose: r.close_price,
        }),
      );
    },
    async fundHoldings() {
      const rows = await client.mfHoldings(token);
      return rows.map((r) => ({
        folio: r.folio,
        fund: r.fund,
        isin: r.tradingsymbol, // Kite uses the ISIN as the MF tradingsymbol
        units: r.quantity,
        averageNav: r.average_price,
        lastNav: r.last_price,
        navDate: r.last_price_date.slice(0, 10),
      }));
    },
    async positions() {
      const { net } = await client.positions(token);
      return net.map((p) => ({
        symbol: p.tradingsymbol,
        exchange: p.exchange,
        product: p.product,
        quantity: p.quantity,
        averagePrice: p.average_price,
        lastPrice: p.last_price,
        pnl: p.pnl,
      }));
    },
  };
}
