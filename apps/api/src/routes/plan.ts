import { actualAllocation, SAMPLE_PLAN, type ActualAllocation, type PlanInput } from "@kairo/core";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { AppError } from "../errors.js";
import type { Session } from "../session.js";

const money = z.number().finite().min(0).max(1e12);
const rate = z.number().finite().min(-0.2).max(0.5);

export const PlanSchema: z.ZodType<PlanInput> = z.object({
  version: z.literal(1),
  income: money,
  essentials: money,
  lifestyle: money,
  emis: money,
  emergency: z.object({ months: z.number().int().min(0).max(36), saved: money }),
  insurance: z.object({ term: z.boolean(), health: z.boolean() }),
  goals: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        name: z.string().trim().min(1).max(60),
        costToday: money,
        targetYear: z.number().int().min(2000).max(2200),
        priority: z.enum(["must", "should", "nice"]),
        saved: money,
        inflation: rate.optional(),
      }),
    )
    .max(20),
  risk: z.array(z.number().int().min(1).max(3)).max(5),
  assumptions: z.object({ inflation: rate, equity: rate, debt: rate, gold: rate }),
});

const PutBody = z.object({
  plan: PlanSchema,
  /** The updatedAt the client last read, or null for a first save. */
  updatedAt: z.string().datetime().nullable(),
});

interface Row {
  payload: PlanInput;
  updated_at: string;
}

export const planRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    app.addHook("onRequest", async (req) => ctx.assertAccess(req.session));
    const userId = (req: { session: Session | undefined }) => req.session?.userId ?? "DEMO";

    /** What the portfolio holds today, by class. Null if the broker data is unavailable. */
    async function actual(session: Session | undefined): Promise<ActualAllocation | null> {
      try {
        const p = ctx.providerFor(session);
        const [holdings, funds, cash] = await Promise.all([p.holdings(), p.fundHoldings(), p.funds()]);
        const categories = await Promise.all(funds.map((f) => ctx.amfi.byIsin(f.isin).then((n) => n?.category ?? null, () => null)));
        return actualAllocation(holdings, funds.map((f, i) => ({ ...f, category: categories[i] ?? null })), cash.available);
      } catch {
        return null;
      }
    }

    /**
     * The saved plan (or null before the first save) and today's allocation. The
     * maths runs in the browser from shared core code, so edits recompute instantly.
     * The public demo gets a sample plan it can edit locally but never save.
     */
    app.get("/plan", async (req, reply) => {
      reply.header("cache-control", "no-store");
      const allocation = await actual(req.session);
      if (ctx.publicDemo) return { plan: SAMPLE_PLAN, updatedAt: null, sample: true, actual: allocation };
      const [row] = await ctx.db.query<Row>(
        "select payload, to_char(updated_at at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') as updated_at from plans where user_id = $1",
        [userId(req)],
      );
      return { plan: row?.payload ?? null, updatedAt: row?.updated_at ?? null, sample: false, actual: allocation };
    });

    /** Save, refusing if someone else (another tab, another device) saved in between. */
    app.put("/plan", async (req) => {
      ctx.assertWrite(req.session);
      const body = PutBody.safeParse(req.body);
      if (!body.success) throw new AppError(400, "bad_request", body.error.issues[0]?.message ?? "Invalid plan.");
      const { plan, updatedAt } = body.data;
      const rows = await ctx.db.query<{ updated_at: string }>(
        `insert into plans (user_id, payload, updated_at) values ($1, $2::jsonb, clock_timestamp())
         on conflict (user_id) do update set payload = excluded.payload, updated_at = excluded.updated_at
           where $3::timestamptz is not null and plans.updated_at = $3::timestamptz
         returning to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at`,
        [userId(req), JSON.stringify(plan), updatedAt],
      );
      if (!rows[0]) throw new AppError(409, "plan_conflict", "This plan was changed elsewhere. Reload to see the latest version.");
      return { updatedAt: rows[0].updated_at };
    });
  };
