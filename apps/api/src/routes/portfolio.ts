import { sectorAllocation, summarize, valueFunds, valueHoldings, type PortfolioSnapshot } from "@kairo/core";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { AppError } from "../errors.js";

export const portfolioRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    /**
     * One endpoint for the overview. Holdings, funds and cash are fetched in parallel
     * and returned as one snapshot, so the totals and the tables always agree.
     * Live broker data is saved as the fallback snapshot for when the token expires.
     */
    app.get("/portfolio", async (req, reply): Promise<PortfolioSnapshot> => {
      const provider = ctx.providerFor(req.session);
      const [holdings, funds, cash] = await Promise.all([provider.holdings(), provider.fundHoldings(), provider.funds()]);
      const source = provider.status?.().source ?? "demo";

      let snapshotAt: string | null = null;
      if (source === "live" && req.session) {
        await ctx.snapshots.save(req.session.userId, { holdings, funds, cash }).catch((err) => req.log.warn({ err }, "snapshot save failed"));
      } else if (source === "snapshot" && req.session) {
        snapshotAt = (await ctx.snapshots.load(req.session.userId))?.takenAt ?? null;
      }

      const sectorByIsin = await ctx.market.sectorsByIsin(holdings.map((h) => h.isin));
      reply.header("cache-control", "no-store");
      return {
        source,
        snapshotAt,
        sectors: sectorAllocation(holdings, sectorByIsin),
        asOf: new Date().toISOString(),
        summary: summarize(holdings, funds),
        cash,
        holdings: valueHoldings(holdings).sort((a, b) => b.current - a.current),
        funds: valueFunds(funds).sort((a, b) => b.current - a.current),
      };
    });

    app.get("/portfolio/positions", async (req, reply) => {
      reply.header("cache-control", "no-store");
      return { positions: await ctx.providerFor(req.session).positions() };
    });

    const NavParams = z.object({ isin: z.string().regex(/^IN[A-Z0-9]{10}$/) });
    app.get("/mf/nav/:isin", async (req) => {
      const p = NavParams.safeParse(req.params);
      if (!p.success) throw new AppError(400, "bad_request", "Invalid ISIN.");
      const nav = await ctx.amfi.byIsin(p.data.isin);
      if (!nav) throw new AppError(404, "not_found", "No NAV found for this ISIN.");
      return nav;
    });
  };
