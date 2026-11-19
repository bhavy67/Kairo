import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { AppError } from "../errors.js";
import type { Fetch } from "../kite/client.js";
import { runEodJob } from "../market/ingest.js";
import { NseArchive } from "../market/nse-archive.js";

const Query = z.object({
  days: z.coerce.number().int().min(1).max(500).default(10),
  // Each trading day is ~2 file downloads + one bulk upsert: keep well inside a 60 s function.
  limit: z.coerce.number().int().min(1).max(25).default(8),
});

/**
 * Scheduler entry point for stateless hosts. Vercel Cron calls GET with
 * `Authorization: Bearer $CRON_SECRET`. Larger `days` lets an operator seed
 * history in chunks: call repeatedly until `more` is false.
 */
export const cronRoutes =
  (ctx: AppContext, fetchImpl: Fetch): FastifyPluginAsync =>
  async (app) => {
    const secret = ctx.config.CRON_SECRET;
    if (!secret) return;
    const expected = Buffer.from(`Bearer ${secret}`);

    app.get("/eod", async (req) => {
      const got = Buffer.from(req.headers.authorization ?? "");
      if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new AppError(401, "unauthorized", "Bad cron token.");
      const q = Query.parse(req.query);
      const nse = new NseArchive(ctx.config.NSE_ARCHIVE_URL, fetchImpl);
      const started = Date.now();
      const job = await runEodJob(ctx.db, nse, { days: q.days, limit: q.limit, now: ctx.now(), delayMs: 150, log: req.log });
      const count = (s: string) => job.results.filter((r) => r.status === s).length;
      // New data: precompute today's overview so the first visitor doesn't pay for it.
      if (count("ok") > 0) await ctx.market.refreshSnapshot();
      return {
        ok: count("failed") === 0,
        ms: Date.now() - started,
        constituentsRefreshed: job.constituentsRefreshed,
        ingested: count("ok"),
        skipped: count("skipped"),
        failed: job.results.filter((r) => r.status === "failed"),
        pending: count("pending"),
        more: job.more,
      };
    });
  };
