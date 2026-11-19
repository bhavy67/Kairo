import { GLOBAL_SERIES, UNAVAILABLE, overnightCues, toQuote, type GlobalQuote, type Point } from "@kairo/core";
import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../app.js";

export const globalRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    app.addHook("onRequest", async (req) => ctx.assertAccess(req.session));

    app.get("/global", async (_req, reply) => {
      const rows = await ctx.db.query<{ id: string; date: string; value: number }>(
        "select id, date::text as date, value from global_series where date > current_date - 120 order by id, date",
      );
      const byId = new Map<string, Point[]>();
      for (const r of rows) byId.set(r.id, [...(byId.get(r.id) ?? []), { date: r.date, value: r.value }]);
      const quotes = GLOBAL_SERIES.map((s) => toQuote(s, byId.get(s.id) ?? [])).filter((q): q is GlobalQuote => q !== null);
      reply.header("cache-control", "private, max-age=300");
      return {
        quotes,
        cues: overnightCues(quotes),
        unavailable: UNAVAILABLE,
        sources: "US indices, Nikkei, US 10-year and Brent: FRED (St. Louis Fed), end of day. Currencies: ECB reference rates.",
      };
    });
  };
