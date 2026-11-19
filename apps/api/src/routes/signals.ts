import { PRESETS, runScreen, type ScreenRule } from "@kairo/core";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { AppError } from "../errors.js";
import { latestIndicatorDate, loadRows } from "../market/indicators.js";
import { AlertSchema, SaveScreenSchema, ScreenRuleSchema } from "../signals/schema.js";

const Id = z.object({ id: z.coerce.number().int().positive() });

export const signalsRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    app.addHook("onRequest", async (req) => ctx.assertAccess(req.session));
    const repo = ctx.signals;

    const run = async (rule: ScreenRule) => {
      const asOf = await latestIndicatorDate(ctx.db);
      if (!asOf) return { asOf: null, rows: [] };
      return { asOf, rows: runScreen(await loadRows(ctx.db, asOf, rule.universe), rule) };
    };

    /** "Stocks of the day": every preset's top matches from one load per universe. */
    app.get("/screens/today", async (_req, reply) => {
      const asOf = await latestIndicatorDate(ctx.db);
      reply.header("cache-control", "private, max-age=300");
      if (!asOf) return { asOf: null, presets: [] };
      const universes = [...new Set(PRESETS.map((p) => p.rule.universe))];
      const rows = new Map(await Promise.all(universes.map(async (u) => [u, await loadRows(ctx.db, asOf, u)] as const)));
      return {
        asOf,
        presets: PRESETS.map((p) => {
          // Count every match, not just the preset's display limit.
          const all = runScreen(rows.get(p.rule.universe)!, { ...p.rule, limit: Number.MAX_SAFE_INTEGER });
          return { id: p.id, name: p.name, description: p.description, rule: p.rule, total: all.length, rows: all.slice(0, 8) };
        }),
      };
    });

    app.post("/screens/run", async (req) => {
      const rule = ScreenRuleSchema.safeParse(req.body);
      if (!rule.success) throw new AppError(400, "bad_request", rule.error.issues[0]?.message ?? "Invalid screen rule.");
      return run(rule.data);
    });

    app.get("/screens", async () => ({ screens: await repo.screens() }));

    app.post("/screens", async (req, reply) => {
      ctx.assertWrite(req.session);
      const body = SaveScreenSchema.safeParse(req.body);
      if (!body.success) throw new AppError(400, "bad_request", body.error.issues[0]?.message ?? "Invalid screen.");
      const id = await repo.addScreen(body.data.name, body.data.rule, body.data.alert);
      return reply.status(201).send({ id });
    });

    app.get("/screens/:id/run", async (req) => {
      const { id } = Id.parse(req.params);
      const screen = await repo.screen(id);
      if (!screen) throw new AppError(404, "not_found", "No such screen.");
      return run(screen.rule);
    });

    app.delete("/screens/:id", async (req, reply) => {
      ctx.assertWrite(req.session);
      const { id } = Id.parse(req.params);
      if (!(await repo.removeScreen(id))) throw new AppError(404, "not_found", "No such screen.");
      return reply.status(204).send();
    });

    app.get("/alerts", async () => ({ alerts: await repo.alerts(), events: await repo.events(), channel: ctx.notifier?.name ?? null }));

    app.post("/alerts", async (req, reply) => {
      ctx.assertWrite(req.session);
      const body = AlertSchema.safeParse(req.body);
      if (!body.success) throw new AppError(400, "bad_request", body.error.issues[0]?.message ?? "Invalid alert.");
      if (!(await ctx.market.symbolExists(body.data.symbol))) {
        throw new AppError(404, "unknown_symbol", `${body.data.symbol} is not in the latest NSE bhavcopy.`);
      }
      const id = await repo.addAlert(body.data.symbol, body.data.kind, body.data.threshold);
      return reply.status(201).send({ id });
    });

    app.delete("/alerts/:id", async (req, reply) => {
      ctx.assertWrite(req.session);
      const { id } = Id.parse(req.params);
      if (!(await repo.removeAlert(id))) throw new AppError(404, "not_found", "No such alert.");
      return reply.status(204).send();
    });
  };
