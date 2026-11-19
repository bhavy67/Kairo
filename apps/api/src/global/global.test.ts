import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db/db.js";
import { testDb } from "../test-db.js";
import { runGlobalJob } from "./ingest.js";

const NOW = Date.parse("2026-11-19T03:00:00Z"); // 08:30 IST, before the Indian open

function fakeSources({ fredDown = false } = {}) {
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith("https://fred.test/")) {
      if (fredDown) return new Response("busy", { status: 503 });
      const id = /id=([A-Z0-9]+)/.exec(url)![1]!;
      const base: Record<string, number> = { SP500: 7400, NASDAQCOM: 23000, DJIA: 46000, NIKKEI225: 50000, DGS10: 4.2, DCOILBRENTEU: 72 };
      const v = base[id]!;
      return new Response(`observation_date,${id}\n2026-11-17,${v}\n2026-11-18,.\n2026-11-18,${v * 0.99}\n`);
    }
    if (url.startsWith("https://fx.test/")) {
      return Response.json({ base: "INR", rates: { "2026-11-18": { USD: 0.0107, EUR: 0.0092, GBP: 0.0081, JPY: 1.62 }, "2026-11-19": { USD: 0.01072, EUR: 0.0092, GBP: 0.0081, JPY: 1.6 } } });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { src: { fredUrl: "https://fred.test", fxUrl: "https://fx.test", fetch: fetchImpl }, urls };
}

let db: Db;
beforeEach(async () => {
  db = await testDb();
});
afterEach(async () => db.close());

describe("global series", () => {
  it("loads history on first run, then asks only for recent days", async () => {
    const { src, urls } = fakeSources();
    const first = await runGlobalJob(db, src, NOW);
    expect(first.failed).toEqual([]);
    expect(first.ok).toHaveLength(10);
    expect(urls.find((u) => u.includes("SP500"))).toContain("cosd=2025-10-15"); // 400 days back

    urls.length = 0;
    await runGlobalJob(db, src, NOW);
    expect(urls.find((u) => u.includes("SP500"))).toContain("cosd=2026-11-08"); // last date minus overlap
  });

  it("keeps currencies when FRED is down, and serves quotes with cues", async () => {
    const { src } = fakeSources({ fredDown: true });
    const r = await runGlobalJob(db, src, NOW);
    expect(r.failed.map((f) => f.id).sort()).toEqual(["brent", "dow", "nasdaq", "nikkei", "sp500", "us10y"]);
    expect(r.ok.sort()).toEqual(["eurinr", "gbpinr", "jpyinr", "usdinr"]);

    await runGlobalJob(db, fakeSources().src, NOW);
    const app = await buildApp({ db, config: loadConfig({ NODE_ENV: "test" }), logger: false });
    const body = (await app.inject("/api/global")).json();
    const sp = body.quotes.find((q: { id: string }) => q.id === "sp500");
    expect(sp).toMatchObject({ date: "2026-11-18", value: 7326 });
    expect(sp.change).toBeCloseTo(-0.01);
    expect(body.quotes.find((q: { id: string }) => q.id === "us10y").change).toBeCloseTo(-0.042);
    expect(body.cues).toMatch(/^US stocks fell: S&P 500 -1\.0%, Nasdaq -1\.0%\. Nikkei -1\.0%\. Brent \$71\.3 \(-1\.0%\)\. ₹93\.28 per dollar, rupee stronger\.$/);
    expect(body.unavailable).toEqual(["FTSE 100", "DAX", "Hang Seng"]);
    await app.close();
  });
});
