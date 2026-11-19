import { matchLots, parseTradebook, summarizeTrades, TradebookError, type KeyedTrade, type Trade } from "@kairo/core";
import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../app.js";
import { AppError } from "../errors.js";
import { istDate } from "../market/calendar.js";
import { DEMO_TRADES } from "../trades/demo.js";
import { TradesRepo } from "../trades/repo.js";

/** Vercel caps request bodies at 4.5 MB: roughly 30k trades, years of history for most investors. */
const MAX_UPLOAD = 4 * 1024 * 1024;

export const tradesRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    app.addHook("onRequest", async (req) => ctx.assertAccess(req.session));
    const repo = new TradesRepo(ctx.db);

    app.addContentTypeParser(["text/csv", "text/plain"], { parseAs: "string", bodyLimit: MAX_UPLOAD }, (_req, body, done) => done(null, body));

    app.post("/trades/import", { bodyLimit: MAX_UPLOAD }, async (req, reply) => {
      ctx.assertWrite(req.session);
      if (typeof req.body !== "string" || !req.body.trim()) throw new AppError(400, "bad_request", "Send the tradebook CSV as text/csv.");
      let parsed;
      try {
        parsed = parseTradebook(req.body);
      } catch (err) {
        if (err instanceof TradebookError) throw new AppError(400, "bad_tradebook", err.message);
        throw err;
      }
      const filename = typeof req.headers["x-filename"] === "string" ? req.headers["x-filename"].slice(0, 120) : null;
      const result = await repo.insert(parsed.trades, filename, parsed.skipped.length);
      return reply.status(201).send({ ...result, parsed: parsed.trades.length, skipped: parsed.skipped.slice(0, 20), skippedCount: parsed.skipped.length });
    });

    app.delete("/trades", async (req, reply) => {
      ctx.assertWrite(req.session);
      await repo.clear();
      return reply.status(204).send();
    });

    app.get("/trades/summary", async (req, reply) => {
      reply.header("cache-control", "no-store");
      // Public demo: a fixed sample tradebook. Local demo: the DB if anything was imported.
      let trades: Trade[] = ctx.publicDemo ? [] : await repo.all();
      const sample = trades.length === 0 && ctx.config.DATA_MODE === "demo";
      if (sample) trades = DEMO_TRADES;
      if (trades.length === 0) return { sample: false, summary: null };

      const provider = ctx.providerFor(req.session);
      const holdings = await provider.holdings();

      const fromTrades = new Map(trades.filter((t) => t.exchange === "NSE" && t.isin).map((t) => [t.isin, t.symbol]));
      const isins = [...new Set([...trades.map((t) => t.isin), ...holdings.map((h) => h.isin)])];
      const symbolOf = await repo.symbolsForIsins(isins, fromTrades);
      const keyOf = (isin: string, symbol: string) => (isin && symbolOf.get(isin)) || symbol;

      const keyed: KeyedTrade[] = trades.map((t) => ({ ...t, key: keyOf(t.isin, t.symbol) }));
      const keys = [...new Set(keyed.map((t) => t.key))];
      const result = matchLots(keyed, sample ? [] : await repo.actions(keys));

      const prices = new Map<string, number>();
      const broker = new Map<string, number>();
      for (const h of holdings) {
        const k = keyOf(h.isin, h.symbol);
        prices.set(k, h.lastPrice);
        broker.set(k, (broker.get(k) ?? 0) + h.quantity);
      }
      const unpriced = [...new Set(result.lots.map((l) => l.key))].filter((k) => !prices.has(k));
      for (const [k, close] of await repo.lastCloses(unpriced)) prices.set(k, close);

      return { sample, summary: summarizeTrades(keyed, result, prices, broker, istDate(ctx.now())) };
    });
  };
