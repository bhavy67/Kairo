import type { FastifyPluginAsync } from "fastify";
import { parseSymbolList } from "@kairo/core";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { AppError } from "../errors.js";

const Symbol = z.string().trim().toUpperCase().regex(/^[A-Z0-9&-]{1,20}$/);
const AddWatch = z.object({ symbol: Symbol, note: z.string().trim().max(200).optional() });

export const marketRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    app.addHook("onRequest", async (req) => ctx.assertAccess(req.session));

    /** EOD data changes once a day, so the browser may cache it briefly. */
    app.get("/market/overview", async (_req, reply) => {
      reply.header("cache-control", "private, max-age=300");
      return ctx.market.overview();
    });

    app.get("/market/ingest", async () => ({ runs: await ctx.market.ingestRuns() }));

    app.get("/watchlist", async () => ({ items: ctx.publicDemo ? [] : await ctx.market.watchlist() }));

    app.post("/watchlist", async (req, reply) => {
      ctx.assertWrite(req.session);
      const body = AddWatch.safeParse(req.body);
      if (!body.success) throw new AppError(400, "bad_request", "Provide a valid NSE symbol.");
      if (!(await ctx.market.symbolExists(body.data.symbol))) {
        throw new AppError(404, "unknown_symbol", `${body.data.symbol} is not in the latest NSE bhavcopy.`);
      }
      await ctx.market.addWatch(body.data.symbol, body.data.note ?? null);
      return reply.status(201).send({ symbol: body.data.symbol });
    });

    /**
     * Add many symbols at once (a list copied from Kite's marketwatch or a spreadsheet).
     * Each is checked against the latest bhavcopy in one query; unknown ones are reported.
     */
    app.post("/watchlist/bulk", async (req, reply) => {
      ctx.assertWrite(req.session);
      const body = z.object({ text: z.string().max(10_000) }).safeParse(req.body);
      if (!body.success) throw new AppError(400, "bad_request", "Paste symbols separated by commas, spaces or new lines.");
      const { symbols, invalid, truncated } = parseSymbolList(body.data.text);
      const known = new Set(
        symbols.length
          ? (
              await ctx.db.query<{ symbol: string }>(
                "select symbol from daily_bars where date = (select max(date) from daily_bars) and symbol = any($1::text[])",
                [symbols],
              )
            ).map((r) => r.symbol)
          : [],
      );
      const valid = symbols.filter((s) => known.has(s));
      const added = valid.length
        ? (
            await ctx.db.query<{ symbol: string }>(
              "insert into watchlist_items (symbol) select unnest($1::text[]) on conflict (symbol) do nothing returning symbol",
              [valid],
            )
          ).map((r) => r.symbol)
        : [];
      return reply.status(200).send({
        added,
        already: valid.filter((s) => !added.includes(s)),
        unknown: [...symbols.filter((s) => !known.has(s)), ...invalid],
        truncated,
      });
    });

    app.delete("/watchlist/:symbol", async (req, reply) => {
      ctx.assertWrite(req.session);
      const p = z.object({ symbol: Symbol }).safeParse(req.params);
      if (!p.success) throw new AppError(400, "bad_request", "Invalid symbol.");
      if (!(await ctx.market.removeWatch(p.data.symbol))) throw new AppError(404, "not_found", "Not on the watchlist.");
      return reply.status(204).send();
    });
  };
