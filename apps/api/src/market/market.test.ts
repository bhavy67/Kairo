import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db/db.js";
import { migrate } from "../db/migrations.js";
import { testDb } from "../test-db.js";
import { addDays, isWeekend } from "./calendar.js";
import { backfill, ingestDay, refreshConstituents } from "./ingest.js";
import { NseArchive } from "./nse-archive.js";

const BHAV_HEADER =
  "TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4";

type Bar = { symbol: string; isin: string; close: number; prev: number; volume: number };
const bhavRow = (date: string, b: Bar) =>
  `${date},${date},CM,NSE,STK,1,${b.isin},${b.symbol},EQ,,,,,${b.symbol},${b.prev},${Math.max(b.close, b.prev)},${Math.min(b.close, b.prev)},${b.close},${b.close},${b.prev},,${b.close},,,${b.volume},${b.volume * b.close},1,F1,1,,,,,`;

const CONSTITUENTS = `Company Name,Industry,Symbol,Series,ISIN Code
Up Ltd.,Information Technology,UP,EQ,INE000000UP1
Down Ltd.,Metals & Mining,DOWN,EQ,INE000000DN1
`;

/**
 * Synthetic market: UP rises 1/day, DOWN falls 1/day from 500.
 * On the last day UP trades 5x its usual volume. Holidays return 404.
 */
function fakeNse(days: string[], holidays = new Set<string>()) {
  const requests: string[] = [];
  const priceOn = (i: number) => ({ up: 100 + i, down: 500 - i });
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    const notFound = new Response("", { status: 404 });
    if (url.endsWith("ind_nifty500list.csv") || url.endsWith("ind_nifty50list.csv")) return new Response(CONSTITUENTS);
    const bm = /BhavCopy_NSE_CM_0_0_0_(\d{8})_F_0000\.csv\.zip$/.exec(url);
    const im = /ind_close_all_(\d{8})\.csv$/.exec(url);
    const date = bm ? `${bm[1]!.slice(0, 4)}-${bm[1]!.slice(4, 6)}-${bm[1]!.slice(6)}` : im ? `${im[1]!.slice(4)}-${im[1]!.slice(2, 4)}-${im[1]!.slice(0, 2)}` : null;
    const i = date ? days.indexOf(date) : -1;
    if (!date || i < 0 || holidays.has(date)) return notFound;
    const p = priceOn(i);
    const q = priceOn(i - 1);
    if (bm) {
      const last = i === days.length - 1;
      const csv = [BHAV_HEADER, bhavRow(date, { symbol: "UP", isin: "INE000000UP1", close: p.up, prev: q.up, volume: last ? 5000 : 1000 }), bhavRow(date, { symbol: "DOWN", isin: "INE000000DN1", close: p.down, prev: q.down, volume: 1000 })].join("\n");
      return new Response(zipSync({ [`BhavCopy_${bm[1]}.csv`]: strToU8(csv) }));
    }
    const [dd, mm, yyyy] = [date.slice(8), date.slice(5, 7), date.slice(0, 4)];
    return new Response(`Index Name,Index Date,Open Index Value,High Index Value,Low Index Value,Closing Index Value,Points Change,Change(%),Volume,Turnover (Rs. Cr.),P/E,P/B,Div Yield\nNifty 50,${dd}-${mm}-${yyyy},1,1,1,${20000 + i},1,.5,1,1,22,3,1\n`);
  }) as typeof fetch;
  return { nse: new NseArchive("https://nse.test", fetchImpl, 0), requests, fetchImpl };
}

/** N consecutive weekdays ending on the given date. */
function weekdays(n: number, end: string): string[] {
  const out: string[] = [];
  for (let d = end; out.length < n; d = addDays(d, -1)) if (!isWeekend(d)) out.unshift(d);
  return out;
}

// Thursday 2026-11-19, 20:00 IST: today's file should be out.
const NOW = Date.parse("2026-11-19T14:30:00Z");

let db: Db;
beforeEach(async () => {
  db = await testDb();
});
afterEach(async () => db.close());

describe("migrations", () => {
  it("are idempotent", async () => {
    expect(await migrate(db)).toEqual([]);
  });
});

describe("ingestDay", () => {
  it("loads bars and index closes, and re-running is harmless", async () => {
    const days = weekdays(3, "2026-11-19");
    const { nse } = fakeNse(days);
    expect(await ingestDay(db, nse, days[2]!, NOW)).toMatchObject({ status: "ok", rows: 2 });
    expect(await ingestDay(db, nse, days[2]!, NOW)).toMatchObject({ status: "ok", rows: 2 });
    const [c] = await db.query<{ n: number }>("select count(*)::int as n from daily_bars");
    expect(c!.n).toBe(2);
    const [idx] = await db.query<{ change_pct: number }>("select change_pct from index_bars");
    expect(idx!.change_pct).toBeCloseTo(0.005);
  });

  it("records a past 404 as a holiday but leaves today's 404 pending", async () => {
    const days = weekdays(3, "2026-11-19");
    const { nse } = fakeNse(days, new Set([days[1]!, days[2]!]));
    expect((await ingestDay(db, nse, days[1]!, NOW)).status).toBe("skipped");
    expect((await ingestDay(db, nse, days[2]!, NOW)).status).toBe("pending");
    const runs = await db.query<{ date: string }>("select date::text as date from ingest_runs");
    expect(runs.map((r) => r.date)).toEqual([days[1]]);
  });

  it("asks NSE about weekends and records a 404 as no session", async () => {
    const { nse, requests } = fakeNse([]);
    expect((await ingestDay(db, nse, "2026-11-08", NOW)).status).toBe("skipped");
    expect(requests.length).toBe(2);
    const [run] = await db.query<{ error: string }>("select error from ingest_runs");
    expect(run!.error).toBe("no session");
  });

  it("imports a weekend special session when NSE has one", async () => {
    const { nse } = fakeNse(["2026-11-08"]); // Sunday Muhurat session
    expect((await ingestDay(db, nse, "2026-11-08", NOW)).status).toBe("ok");
  });
});

describe("backfill and overview", () => {
  it("computes breadth, sectors, movers and indices from stored history", async () => {
    const days = weekdays(260, "2026-11-19");
    const { nse, requests } = fakeNse(days);
    await refreshConstituents(db, nse);
    const results = await backfill(db, nse, { days: 380, now: NOW, delayMs: 0 });
    expect(results.filter((r) => r.status === "failed")).toEqual([]);

    // A second run finds nothing to do and makes no requests.
    const before = requests.length;
    await backfill(db, nse, { days: 380, now: NOW, delayMs: 0 });
    expect(requests.length).toBe(before);

    const app = await buildApp({ db, config: loadConfig({ NODE_ENV: "test" }), logger: false });
    const res = await app.inject("/api/market/overview");
    expect(res.statusCode).toBe(200);
    const o = res.json();
    expect(o.asOf).toBe("2026-11-19");
    expect(o.breadth).toMatchObject({ advances: 1, declines: 1, above50: 0.5, above200: 0.5, newHighs: 1, newLows: 1 });
    expect(o.sectors[0].industry).toBe("Information Technology");
    expect(o.gainers[0].symbol).toBe("UP");
    expect(o.volumeSpikes[0]).toMatchObject({ symbol: "UP", volumeRatio: 5 });
    expect(o.indices[0]).toMatchObject({ name: "Nifty 50", close: 20259 });
    expect(o.indices[0].history).toHaveLength(60);

    // The first read stored a snapshot; a fresh instance serves it without recomputing.
    const [snap] = await db.query<{ n: number }>("select count(*)::int as n from market_snapshots");
    expect(snap!.n).toBe(1);
    await db.query("delete from index_members"); // would empty the universe if recomputed
    const other = await buildApp({ db, config: loadConfig({ NODE_ENV: "test" }), logger: false });
    expect((await other.inject("/api/market/overview")).json().breadth.advances).toBe(1);
    await other.close();
    await refreshConstituents(db, nse);

    // Watchlist validates against the latest bhavcopy.
    expect((await app.inject({ method: "POST", url: "/api/watchlist", payload: { symbol: "up" } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/watchlist", payload: { symbol: "NOPE" } })).statusCode).toBe(404);
    const wl = (await app.inject("/api/watchlist")).json();
    expect(wl.items[0]).toMatchObject({ symbol: "UP", name: "Up Ltd.", close: 359 });
    expect((await app.inject({ method: "DELETE", url: "/api/watchlist/UP" })).statusCode).toBe(204);
    await app.close();
  }, 30_000);

  it("returns an empty overview before any data is loaded", async () => {
    const app = await buildApp({ db, config: loadConfig({ NODE_ENV: "test" }), logger: false });
    expect((await app.inject("/api/market/overview")).json()).toMatchObject({ asOf: null, breadth: null });
    await app.close();
  });
});

describe("cron route", () => {
  it("fills missing days in limited chunks and reports when more remain", async () => {
    const days = weekdays(30, "2026-11-19");
    const { fetchImpl } = fakeNse(days);
    const config = loadConfig({ NODE_ENV: "test", CRON_SECRET: "c".repeat(20), NSE_ARCHIVE_URL: "https://nse.test" });
    const app = await buildApp({ db, config, fetch: fetchImpl, now: () => NOW, logger: false });
    const call = () => app.inject({ url: "/api/cron/eod?days=14&limit=4", headers: { authorization: `Bearer ${"c".repeat(20)}` } });
    const first = (await call()).json();
    expect(first).toMatchObject({ ok: true, constituentsRefreshed: true, ingested: 4, more: true });
    let last = first;
    // Each call also checks weekends and corporate-action files, so it takes a few rounds.
    for (let i = 0; i < 10 && last.more; i++) last = (await call()).json();
    expect(last.more).toBe(false);
    const [c] = await db.query<{ n: number }>("select count(distinct date)::int as n from daily_bars");
    expect(c!.n).toBe(10); // 14 calendar days ending Thu 19 Nov (after 18:30 IST) = 10 weekdays
    await app.close();
  });
});

describe("signals: screens and alerts", () => {
  const SECRET = "c".repeat(20);
  const BEARER = { authorization: `Bearer ${SECRET}` };

  async function seeded() {
    const days = weekdays(260, "2026-11-19");
    const nse = fakeNse(days);
    const sent: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).startsWith("https://api.telegram.org/")) {
        sent.push(JSON.parse(String(init!.body)).text);
        return new Response("{}", { status: 200 });
      }
      return nse.fetchImpl(input, init);
    }) as typeof fetch;
    // Load all but the last day, so the cron run below imports "today" and evaluates alerts.
    await refreshConstituents(db, nse.nse);
    await backfill(db, nse.nse, { days: 380, now: NOW - 86_400_000, delayMs: 0 });
    const config = loadConfig({
      NODE_ENV: "test", CRON_SECRET: SECRET, NSE_ARCHIVE_URL: "https://nse.test",
      TELEGRAM_BOT_TOKEN: "t".repeat(30), TELEGRAM_CHAT_ID: "42",
    });
    const app = await buildApp({ db, config, fetch: fetchImpl, now: () => NOW, logger: false });
    return { app, sent };
  }

  it("computes indicators, runs presets and custom rules", async () => {
    const { app } = await seeded();
    await app.inject({ url: "/api/cron/eod?days=3", headers: BEARER });

    const today = (await app.inject("/api/screens/today")).json();
    expect(today.asOf).toBe("2026-11-19");
    const byId = Object.fromEntries(today.presets.map((p: { id: string; rows: { symbol: string }[] }) => [p.id, p.rows.map((r) => r.symbol)]));
    expect(byId.breakouts).toEqual(["UP"]);
    expect(byId.momentum).toEqual(["UP"]);
    expect(byId.oversold).toEqual(["DOWN"]); // the fake Nifty 50 list holds both; DOWN has RSI 0

    const up = today.presets.find((p: { id: string }) => p.id === "momentum").rows[0];
    expect(up.rsi14).toBe(100); // no down days
    expect(up.ret63d).toBeCloseTo(359 / 296 - 1, 6);

    const custom = await app.inject({
      method: "POST", url: "/api/screens/run",
      payload: { universe: "NIFTY 500", conditions: [{ field: "close", op: "<", other: "sma200" }], sort: { field: "changePct", dir: "asc" }, limit: 5 },
    });
    expect(custom.json().rows.map((r: { symbol: string }) => r.symbol)).toEqual(["DOWN"]);

    const injected = await app.inject({
      method: "POST", url: "/api/screens/run",
      payload: { universe: "NIFTY 500", conditions: [{ field: "close; drop table x", op: ">", value: 1 }], sort: { field: "close", dir: "asc" }, limit: 5 },
    });
    expect(injected.statusCode).toBe(400);
    await app.close();
  }, 30_000);

  it("fires alerts once, sends one Telegram digest, and never re-sends", async () => {
    const { app, sent } = await seeded();
    const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload });
    expect((await post("/api/alerts", { symbol: "UP", kind: "price_above", threshold: 358.5 })).statusCode).toBe(201);
    expect((await post("/api/alerts", { symbol: "UP", kind: "price_above", threshold: 100 })).statusCode).toBe(201); // already above
    expect((await post("/api/alerts", { symbol: "DOWN", kind: "move_pct", threshold: 5 })).statusCode).toBe(400); // 5 means 500%: must be a fraction
    expect((await post("/api/alerts", { symbol: "NOPE", kind: "cross_200dma" })).statusCode).toBe(404);
    const breakouts = { universe: "NIFTY 500", conditions: [{ flag: "newHigh52" }], sort: { field: "volRatio", dir: "desc" }, limit: 10 };
    expect((await post("/api/screens", { name: "Breakouts", rule: breakouts, alert: true })).statusCode).toBe(201);

    const first = (await app.inject({ url: "/api/cron/eod?days=3", headers: BEARER })).json();
    expect(first.alerts).toMatchObject({ date: "2026-11-19", newEvents: 2, delivered: 2 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("UP closed above ₹358.5 at ₹359");
    expect(sent[0]).toContain('UP entered "Breakouts"');

    // A retried cron run: no new events, nothing re-sent.
    const again = (await app.inject({ url: "/api/cron/eod?days=3", headers: BEARER })).json();
    expect(again.alerts).toMatchObject({ newEvents: 0, delivered: 0 });
    expect(sent).toHaveLength(1);

    const list = (await app.inject("/api/alerts")).json();
    expect(list.alerts).toHaveLength(2);
    expect(list.events.map((e: { source: string }) => e.source).sort()).toEqual(["alert", "screen"]);
    await app.close();
  }, 30_000);
});

describe("corporate-action adjustment", () => {
  it("keeps a 1:1 bonus from looking like a crash in returns, SMAs and day change", async () => {
    // 30 sessions at a flat ₹1000; a 1:1 bonus goes ex on the 21st, after which the
    // stock trades at ₹500 and NSE reports the *unadjusted* ₹1000 as previous close.
    const days = weekdays(30, "2026-11-19");
    const ex = days[20]!;
    const bars = days.map((d, i) => {
      const close = i >= 20 ? 500 : 1000;
      const prev = i === 20 ? 1000 : close;
      return [d, close, prev] as const;
    });
    await db.query(
      `insert into daily_bars (symbol, date, isin, open, high, low, close, prev_close, volume, turnover)
       select 'BONUS', d, 'INE000000BN1', c, c, c, c, p, 1000, c * 1000
       from unnest($1::date[], $2::float8[], $3::float8[]) as t(d, c, p)`,
      [bars.map((b) => b[0]), bars.map((b) => b[1]), bars.map((b) => b[2])],
    );
    await db.query("insert into watchlist_items (symbol) values ('BONUS')");
    const { computeIndicators, loadSymbols } = await import("./indicators.js");

    await computeIndicators(db, ex);
    const before = (await loadSymbols(db, ex, ["BONUS"])).get("BONUS")!;
    expect(before.changePct).toBeCloseTo(-0.5); // raw: looks like a crash

    await db.query("insert into corporate_actions values ('BONUS', $1, 'BONUS 1:1', 2)", [ex]);
    await computeIndicators(db, ex);
    const on = (await loadSymbols(db, ex, ["BONUS"])).get("BONUS")!;
    expect(on.changePct).toBeCloseTo(0);
    expect(on.ret21d).toBeCloseTo(0);
    expect(on.sma20).toBeCloseTo(500);
    expect(on.rsi14).toBe(50); // flat after adjustment: neutral, not 'overbought'

    const last = days.at(-1)!;
    await computeIndicators(db, last);
    const after = (await loadSymbols(db, last, ["BONUS"])).get("BONUS")!;
    expect(after.ret21d).toBeCloseTo(0);
    expect(after.hi52).toBe(500); // the pre-bonus ₹1000 does not leak into the adjusted range
    expect(after.fromHigh52).toBeNull(); // and with <200 sessions no 52-week signal is claimed
  });
});

describe("corporate-action reparse", () => {
  it("re-derives ratios from stored purposes and resets stale indicators", async () => {
    const { reparseCorporateActions } = await import("./ingest.js");
    // As stored by an older parser that did not understand NSE's abbreviation.
    await db.query("insert into corporate_actions values ('KMEW', '2026-11-06', 'FV SPLT FRM RS 5 TO RE 1', null)");
    expect(await reparseCorporateActions(db)).toBe(1);
    const [r] = await db.query<{ ratio: number }>("select ratio from corporate_actions");
    expect(r!.ratio).toBe(5);
    expect(await reparseCorporateActions(db)).toBe(0); // idempotent

    // A server that returns float8 rounded to 15 digits must not look like a change.
    await db.query("insert into corporate_actions values ('GOLDIAM', '2026-07-10', 'BONUS 1:3', 1.33333333333333)");
    expect(await reparseCorporateActions(db)).toBe(0);
  });
});

describe("stock detail and search", () => {
  it("returns an adjusted one-year series, signals and symbol search", async () => {
    const days = weekdays(260, "2026-11-19");
    const { nse } = fakeNse(days);
    await refreshConstituents(db, nse);
    await backfill(db, nse, { days: 380, now: NOW, delayMs: 0 });
    const app = await buildApp({ db, config: loadConfig({ NODE_ENV: "test" }), logger: false });
    await app.inject("/api/market/overview"); // computes indicators

    const res = await app.inject("/api/stocks/up");
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s).toMatchObject({ symbol: "UP", name: "Up Ltd.", asOf: "2026-11-19", close: 359 });
    expect(s.series.length).toBeGreaterThan(200);
    expect(s.signals.rsi14).toBe(100);
    expect((await app.inject("/api/stocks/NOPE")).statusCode).toBe(404);

    expect((await app.inject("/api/symbols?q=u")).json().results[0]).toEqual({ symbol: "UP", name: "Up Ltd." });
    expect((await app.inject("/api/symbols?q=down%20l")).json().results.map((r: { symbol: string }) => r.symbol)).toEqual(["DOWN"]);
    await app.close();
  }, 30_000);
});
