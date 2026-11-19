import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { AppError } from "../errors.js";
import type { Fetch } from "../kite/client.js";
import { runEodJob } from "../market/ingest.js";
import { NseArchive } from "../market/nse-archive.js";
import { runAlertJob } from "../signals/job.js";
import { runGlobalJob } from "../global/ingest.js";

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
    const authorize = (header: string | undefined) => {
      const got = Buffer.from(header ?? "");
      if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new AppError(401, "unauthorized", "Bad cron token.");
    };
    const globalSources = { fredUrl: ctx.config.FRED_URL, fxUrl: ctx.config.FX_URL, fetch: fetchImpl };

    /** Morning run before the Indian open: US closes and fresh rupee rates. */
    app.get("/global", async (req) => {
      authorize(req.headers.authorization);
      return runGlobalJob(ctx.db, globalSources, ctx.now());
    });

    app.get("/eod", async (req) => {
      authorize(req.headers.authorization);
      const q = Query.parse(req.query);
      const nse = new NseArchive(ctx.config.NSE_ARCHIVE_URL, fetchImpl);
      const started = Date.now();
      const job = await runEodJob(ctx.db, nse, { days: q.days, limit: q.limit, now: ctx.now(), delayMs: 150, log: req.log });
      const count = (s: string) => job.results.filter((r) => r.status === s).length;
      // New data: compute indicators + today's overview once, then alerts on top of them.
      // Alerts also run with no new data so undelivered messages get retried.
      let alerts = null;
      if (count("ok") > 0 || job.reparsed > 0) await ctx.market.refreshSnapshot();
      const latest = await ctx.market.latestDate();
      if (latest && !job.more) alerts = await runAlertJob(ctx.db, ctx.signals, latest, ctx.notifier);
      // The evening run refreshes global series too, so one schedule is enough if the morning one is absent.
      const global = job.more ? null : await runGlobalJob(ctx.db, globalSources, ctx.now());
      return {
        ok: count("failed") === 0,
        ms: Date.now() - started,
        constituentsRefreshed: job.constituentsRefreshed,
        reparsedActions: job.reparsed,
        ingested: count("ok"),
        skipped: count("skipped"),
        failed: job.results.filter((r) => r.status === "failed"),
        pending: count("pending"),
        more: job.more,
        alerts,
        global: global && { ok: global.ok.length, failed: global.failed, rows: global.rows },
      };
    });
  };
