import { GLOBAL_SERIES, METAL_ETFS, UNAVAILABLE, overnightCues, toQuote, type GlobalQuote, type Point } from "@kairo/core";
import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../app.js";

export const globalRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    app.addHook("onRequest", async (req) => ctx.assertAccess(req.session));

    /** Gold and silver from NSE data already stored: ETF closes, and the most traded gold bond as ₹ per gram. */
    async function metalQuotes(): Promise<GlobalQuote[]> {
      const rows = await ctx.db.query<{ symbol: string; date: string; close: number }>(
        `select symbol, date::text as date, close from daily_bars
         where symbol = any($1::text[]) and date > current_date - 120 order by symbol, date`,
        [METAL_ETFS.map((m) => m.symbol)],
      );
      const out: GlobalQuote[] = [];
      for (const m of METAL_ETFS) {
        const pts = rows.filter((r) => r.symbol === m.symbol).map((r) => ({ date: r.date, value: r.close }));
        const q = toQuote({ id: m.id, label: m.label, group: "Gold & silver", kind: "commodity", source: "nse", code: m.symbol, unit: "₹" }, pts);
        if (q) out.push(q);
      }
      const [sgb] = await ctx.db.query<{ symbol: string; date: string; close: number; prev_close: number }>(
        `select symbol, date::text as date, close, prev_close from daily_bars
         where symbol like 'SGB%' and date = (select max(date) from daily_bars where symbol like 'SGB%')
         order by turnover desc limit 1`,
      );
      if (sgb) {
        out.push({
          id: "sgb",
          label: `Gold per gram · ${sgb.symbol}`,
          group: "Gold & silver",
          kind: "commodity",
          unit: "₹",
          date: sgb.date,
          value: sgb.close,
          change: sgb.prev_close > 0 ? sgb.close / sgb.prev_close - 1 : null,
          history: [],
        });
      }
      return out;
    }

    app.get("/global", async (_req, reply) => {
      const rows = await ctx.db.query<{ id: string; date: string; value: number }>(
        "select id, date::text as date, value from global_series where date > current_date - 120 order by id, date",
      );
      const byId = new Map<string, Point[]>();
      for (const r of rows) byId.set(r.id, [...(byId.get(r.id) ?? []), { date: r.date, value: r.value }]);
      const quotes = GLOBAL_SERIES.map((s) => toQuote(s, byId.get(s.id) ?? [])).filter((q): q is GlobalQuote => q !== null);
      quotes.push(...(await metalQuotes()));
      reply.header("cache-control", "private, max-age=300");
      return {
        quotes,
        cues: overnightCues(quotes),
        unavailable: UNAVAILABLE,
        sources:
          "US indices, Nikkei, US 10-year and Brent: FRED (St. Louis Fed). Currencies: ECB reference rates. Gold and silver: NSE closing prices of ETFs and Sovereign Gold Bonds. All end of day.",
      };
    });
  };
