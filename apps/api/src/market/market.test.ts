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

  it("skips weekends without calling NSE", async () => {
    const { nse, requests } = fakeNse([]);
    expect((await ingestDay(db, nse, "2026-11-21", NOW)).status).toBe("skipped");
    expect(requests).toEqual([]);
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
    for (let i = 0; i < 5 && last.more; i++) last = (await call()).json();
    expect(last.more).toBe(false);
    const [c] = await db.query<{ n: number }>("select count(distinct date)::int as n from daily_bars");
    expect(c!.n).toBe(10); // 14 calendar days ending Thu 19 Nov (after 18:30 IST) = 10 weekdays
    await app.close();
  });
});
