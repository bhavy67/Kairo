import { deriveSignals, type Indicator } from "@kairo/core";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { AppError } from "../errors.js";

const Symbol = z.object({ symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9&-]{1,20}$/) });
const Search = z.object({ q: z.string().trim().max(40).default("") });

/**
 * One year of closes, adjusted for bonuses and splits the same way indicators are,
 * so a 1:1 bonus does not draw a cliff on the chart.
 */
const SERIES_SQL = `
  select d.date::text as date, d.close / f.after as close, d.volume::float8 * f.after as volume
  from daily_bars d
  cross join lateral (
    select coalesce(exp(sum(ln(c.ratio))), 1) as after
    from corporate_actions c where c.symbol = d.symbol and c.ex_date > d.date and c.ratio is not null
  ) f
  where d.symbol = $1 and d.date > current_date - 380
  order by d.date`;

export const stockRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    app.addHook("onRequest", async (req) => ctx.assertAccess(req.session));

    /** Symbol search for the command palette: prefix matches on symbol first, then names. */
    app.get("/symbols", async (req, reply) => {
      const { q } = Search.parse(req.query);
      if (q.length < 1) return { results: [] };
      reply.header("cache-control", "private, max-age=3600");
      const like = q.replace(/[%_\\]/g, (c) => `\\${c}`);
      const rows = await ctx.db.query<{ symbol: string; name: string | null; rank: number }>(
        `with latest as (select max(date) as d from daily_bars)
         select b.symbol, i.name,
                case when b.symbol = upper($1) then 0 when b.symbol like upper($1) || '%' then 1 else 2 end as rank
         from daily_bars b join latest on b.date = latest.d
         left join instruments i on i.symbol = b.symbol
         where b.symbol like upper($2) || '%' or i.name ilike '%' || $2 || '%'
         -- Among equal matches, the most traded first: "hdfc" means HDFC Bank before HDFC AMC.
         order by rank, i.name is null, b.turnover desc, b.symbol limit 8`,
        [q, like],
      );
      return { results: rows.map(({ symbol, name }) => ({ symbol, name: name ?? symbol })) };
    });

    app.get("/stocks/:symbol", async (req, reply) => {
      const { symbol } = Symbol.parse(req.params);
      const [series, info, indicator] = await Promise.all([
        ctx.db.query<{ date: string; close: number; volume: number }>(SERIES_SQL, [symbol]),
        ctx.db.query<{ name: string; industry: string; isin: string }>("select name, industry, isin from instruments where symbol = $1", [symbol]),
        ctx.db.query<Indicator>(
          `select i.symbol, coalesce(n.name, i.symbol) as name, coalesce(n.industry, 'Unclassified') as industry,
             i.date::text as date, i.close, i.prev_close as "prevClose", i.high, i.low, i.volume, i.turnover,
             i.change_pct as "changePct", i.ret_5d as "ret5d", i.ret_21d as "ret21d", i.ret_63d as "ret63d",
             i.sma20, i.sma50, i.sma200, i.sma50_prev as "sma50Prev", i.sma200_prev as "sma200Prev",
             i.n50, i.n200, i.rsi14, i.avg_vol20 as "avgVol20", i.avg_turnover20 as "avgTurnover20", i.hi52, i.lo52, i.n52
           from indicators i left join instruments n on n.symbol = i.symbol
           where i.symbol = $1 order by i.date desc limit 1`,
          [symbol],
        ),
      ]);
      if (series.length === 0) throw new AppError(404, "not_found", `${symbol} has no NSE prices in the last year.`);

      const last = series.at(-1)!;
      const prev = series.at(-2);
      // Position comes from the broker (or the demo portfolio); watchlist and alerts
      // are personal tables, never read on the public demo.
      const holding = (await ctx.providerFor(req.session).holdings().catch(() => [])).find((h) => h.symbol === symbol);
      const position = holding ? { quantity: holding.quantity, averagePrice: holding.averagePrice, lastPrice: holding.lastPrice } : null;
      const [watch, alerts] = ctx.publicDemo
        ? [[], []]
        : await Promise.all([
            ctx.db.query("select 1 from watchlist_items where symbol = $1", [symbol]),
            ctx.db.query<{ id: number; kind: string; threshold: number | null }>(
              "select id::int as id, kind, threshold from alerts where symbol = $1 and active",
              [symbol],
            ),
          ]);
      const watching = watch.length > 0;

      reply.header("cache-control", "private, max-age=300");
      return {
        symbol,
        name: info[0]?.name ?? indicator[0]?.name ?? symbol,
        industry: info[0]?.industry ?? null,
        asOf: last.date,
        close: last.close,
        changePct: indicator[0]?.date === last.date ? indicator[0].changePct : prev ? last.close / prev.close - 1 : null,
        series: series.map((s) => ({ date: s.date, close: Math.round(s.close * 100) / 100 })),
        signals: indicator[0] ? deriveSignals(indicator[0]) : null,
        position,
        watching,
        alerts,
      };
    });
  };
