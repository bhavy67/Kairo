import { deriveSignals, type Indicator, type ScreenRow, type Universe } from "@kairo/core";
import type { Db } from "../db/db.js";

/**
 * Compute and store indicators for one trading day, for every stock in the
 * Nifty 500 plus anything on the watchlist or an alert. One statement:
 *
 *   b: daily log return and gain/loss from NSE's adjusted previous close
 *   w: rolling windows (SMAs, RSI averages, compounded returns, 52-week range)
 *   x: yesterday's SMAs via lag(), for crossover detection
 *
 * Bhavcopy prices are raw: NSE does NOT adjust the previous close on an ex-date
 * (a 1:1 bonus shows as a -50% day). The first CTE applies stored corporate-action
 * ratios, so every window below (SMAs, RSI, returns, 52-week range) is adjusted.
 */
const COMPUTE_SQL = `
  insert into indicators (symbol, date, close, prev_close, high, low, volume, turnover, change_pct,
    ret_5d, ret_21d, ret_63d, sma20, sma50, sma200, sma50_prev, sma200_prev, n50, n200,
    rsi14, avg_vol20, avg_turnover20, hi52, lo52, n52)
  with u as (
    select symbol from index_members where index_name = 'NIFTY 500'
    union select symbol from watchlist_items
    union select symbol from alerts where active
  ),
  -- Corporate-action adjustment: prices before an ex-date are divided by the
  -- product of later ratios (after); on the ex-date itself, the raw previous
  -- close is also divided by that day's ratio (on_day). Volumes scale up.
  a as (
    select d.symbol, d.date,
           d.close / f.after as close,
           d.prev_close / (f.after * f.on_day) as prev_close,
           d.high / f.after as high, d.low / f.after as low,
           d.volume::float8 * f.after as volume, d.turnover
    from daily_bars d
    join u on u.symbol = d.symbol
    cross join lateral (
      select coalesce(exp(sum(ln(c.ratio)) filter (where c.ex_date > d.date)), 1) as after,
             coalesce(exp(sum(ln(c.ratio)) filter (where c.ex_date = d.date)), 1) as on_day
      from corporate_actions c where c.symbol = d.symbol and c.ex_date >= d.date and c.ratio is not null
    ) f
    where d.date between $1::date - 400 and $1::date and d.close > 0 and d.prev_close > 0
  ),
  b as (
    select a.*, ln(close / prev_close) as lr,
           greatest(close - prev_close, 0) as gain,
           greatest(prev_close - close, 0) as loss
    from a
  ),
  w as (
    select b.*,
      avg(close) over last20 as sma20,   count(*) over last20 as n20,
      avg(close) over last50 as sma50,   count(*) over last50 as n50,
      avg(close) over last200 as sma200, count(*) over last200 as n200,
      avg(gain) over last14 as g14, avg(loss) over last14 as l14, count(*) over last14 as n14,
      exp(sum(lr) over last5) - 1 as ret5,   count(*) over last5 as n5,
      exp(sum(lr) over last21) - 1 as ret21, count(*) over last21 as n21,
      exp(sum(lr) over last63) - 1 as ret63, count(*) over last63 as n63,
      avg(volume) over prev20 as avg_vol20, avg(turnover) over prev20 as avg_turnover20,
      max(high) over prev250 as hi52, min(low) over prev250 as lo52, count(*) over prev250 as n52
    from b
    window
      last5   as (partition by symbol order by date rows 4 preceding),
      last14  as (partition by symbol order by date rows 13 preceding),
      last20  as (partition by symbol order by date rows 19 preceding),
      last21  as (partition by symbol order by date rows 20 preceding),
      last50  as (partition by symbol order by date rows 49 preceding),
      last63  as (partition by symbol order by date rows 62 preceding),
      last200 as (partition by symbol order by date rows 199 preceding),
      prev20  as (partition by symbol order by date rows between 20 preceding and 1 preceding),
      prev250 as (partition by symbol order by date rows between 250 preceding and 1 preceding)
  ),
  x as (
    select w.*,
      lag(sma50) over s as sma50_prev, lag(sma200) over s as sma200_prev
    from w window s as (partition by symbol order by date)
  )
  select symbol, date, close, prev_close, high, low, volume, turnover, close / prev_close - 1,
    case when n5 = 5 then ret5 end, case when n21 = 21 then ret21 end, case when n63 = 63 then ret63 end,
    case when n20 = 20 then sma20 end, sma50, sma200, sma50_prev, sma200_prev, n50::int, n200::int,
    case when n14 < 14 then null when g14 = 0 and l14 = 0 then 50 when l14 = 0 then 100 else 100 - 100 / (1 + g14 / l14) end,
    avg_vol20, avg_turnover20, hi52, lo52, n52::int
  from x where date = $1::date
  on conflict (symbol, date) do update set
    close = excluded.close, prev_close = excluded.prev_close, high = excluded.high, low = excluded.low,
    volume = excluded.volume, turnover = excluded.turnover, change_pct = excluded.change_pct,
    ret_5d = excluded.ret_5d, ret_21d = excluded.ret_21d, ret_63d = excluded.ret_63d,
    sma20 = excluded.sma20, sma50 = excluded.sma50, sma200 = excluded.sma200,
    sma50_prev = excluded.sma50_prev, sma200_prev = excluded.sma200_prev, n50 = excluded.n50, n200 = excluded.n200,
    rsi14 = excluded.rsi14, avg_vol20 = excluded.avg_vol20, avg_turnover20 = excluded.avg_turnover20,
    hi52 = excluded.hi52, lo52 = excluded.lo52, n52 = excluded.n52`;

const SELECT = `
  select i.symbol, coalesce(n.name, i.symbol) as name, coalesce(n.industry, 'Unclassified') as industry,
    i.date::text as date, i.close, i.prev_close as "prevClose", i.high, i.low, i.volume, i.turnover,
    i.change_pct as "changePct", i.ret_5d as "ret5d", i.ret_21d as "ret21d", i.ret_63d as "ret63d",
    i.sma20, i.sma50, i.sma200, i.sma50_prev as "sma50Prev", i.sma200_prev as "sma200Prev",
    i.n50, i.n200, i.rsi14, i.avg_vol20 as "avgVol20", i.avg_turnover20 as "avgTurnover20",
    i.hi52, i.lo52, i.n52
  from indicators i left join instruments n on n.symbol = i.symbol`;

export async function computeIndicators(db: Db, date: string): Promise<number> {
  await db.query(COMPUTE_SQL, [date]);
  const [r] = await db.query<{ n: number }>("select count(*)::int as n from indicators where date = $1", [date]);
  return r?.n ?? 0;
}

export async function latestIndicatorDate(db: Db): Promise<string | null> {
  const [r] = await db.query<{ d: string | null }>("select max(date)::text as d from indicators");
  return r?.d ?? null;
}

/** Screen rows for a date, optionally limited to an index. */
export async function loadRows(db: Db, date: string, universe?: Universe): Promise<ScreenRow[]> {
  const rows = universe
    ? await db.query<Indicator>(`${SELECT} join index_members m on m.symbol = i.symbol and m.index_name = $2 where i.date = $1`, [date, universe])
    : await db.query<Indicator>(`${SELECT} where i.date = $1`, [date]);
  return rows.map(deriveSignals);
}

export async function loadSymbols(db: Db, date: string, symbols: string[]): Promise<Map<string, ScreenRow>> {
  if (symbols.length === 0) return new Map();
  const rows = await db.query<Indicator>(`${SELECT} where i.date = $1 and i.symbol = any($2::text[])`, [date, symbols]);
  return new Map(rows.map((r) => [r.symbol, deriveSignals(r)]));
}
