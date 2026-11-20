import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { sessionChecksum } from "./kite/client.js";
import { testDb } from "./test-db.js";
import { nextKiteExpiry } from "./session.js";

const KITE_ENV = {
  DATA_MODE: "kite",
  NODE_ENV: "test",
  SESSION_SECRET: "x".repeat(32),
  KITE_API_KEY: "key",
  KITE_API_SECRET: "secret",
  KITE_ALLOWED_USER_ID: "AB1234",
};

type Route = (url: URL, init?: RequestInit) => unknown;
const ok = (data: unknown) => ({ status: "success", data });

/** Fake Kite: answers by path, records calls. */
function fakeKite(overrides: Record<string, Route> = {}) {
  const calls: { method: string; path: string; auth: string | undefined }[] = [];
  const routes: Record<string, Route> = {
    "POST /session/token": () => ok({ user_id: "AB1234", access_token: "tok" }),
    "DELETE /session/token": () => ok(true),
    "GET /user/profile": () => ok({ user_id: "AB1234", user_name: "LADANI BHAVY RAJESHBHAI", user_shortname: "Bhavy", broker: "ZERODHA" }),
    "GET /user/margins": () => ok({ equity: { net: 1000, utilised: { debits: 0 } } }),
    "GET /portfolio/holdings": () =>
      ok([{ tradingsymbol: "INFY", exchange: "NSE", isin: "INE009A01021", quantity: 2, t1_quantity: 1, average_price: 100, last_price: 120, close_price: 110, extra_field: 1 }]),
    "GET /mf/holdings": () => ok([]),
    ...overrides,
  };
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    calls.push({ method: init?.method ?? "GET", path: url.pathname, auth: (init?.headers as Record<string, string>)?.Authorization });
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ status: "error", message: "nope", error_type: "GeneralException" }), { status: 404 });
    return new Response(JSON.stringify(handler(url, init)), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const cookieOf = (res: { cookies: { name: string; value: string }[] }, name: string) =>
  res.cookies.find((c) => c.name === name)?.value;

let app: FastifyInstance;
afterEach(async () => app?.close());

async function signIn(fetchImpl: typeof fetch, userOverride?: string) {
  const login = await app.inject("/api/auth/login");
  const kiteUrl = new URL(login.headers.location as string);
  const state = new URLSearchParams(kiteUrl.searchParams.get("redirect_params")!).get("state")!;
  const stateCookie = cookieOf(login, "kairo_oauth_state")!;
  const cb = await app.inject({
    url: `/api/auth/callback?status=success&request_token=rt&state=${userOverride ?? state}`,
    cookies: { kairo_oauth_state: stateCookie },
  });
  return { login, kiteUrl, cb, sid: cookieOf(cb, "kairo_sid") };
}

describe("kite helpers", () => {
  it("computes the documented checksum", () => {
    expect(sessionChecksum("a", "b", "c")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("expires sessions at the next 06:00 IST", () => {
    expect(new Date(nextKiteExpiry(Date.parse("2026-11-19T00:00:00Z"))).toISOString()).toBe("2026-11-19T00:30:00.000Z");
    expect(new Date(nextKiteExpiry(Date.parse("2026-11-19T00:30:00Z"))).toISOString()).toBe("2026-11-20T00:30:00.000Z");
  });
});

describe("config", () => {
  it("lists every missing kite variable at once", () => {
    expect(() => loadConfig({ DATA_MODE: "kite" })).toThrow(/KITE_API_KEY[\s\S]*KITE_ALLOWED_USER_ID/);
  });
});

describe("demo mode", () => {
  it("serves a portfolio without login", async () => {
    app = await buildApp({ db: await testDb(), config: loadConfig({ NODE_ENV: "test" }), logger: false });
    const res = await app.inject("/api/portfolio");
    expect(res.statusCode).toBe(200);
    expect(res.json().holdings.length).toBeGreaterThan(0);
  });
});

describe("kite auth flow", () => {
  it("signs in, then serves holdings with the session token", async () => {
    const { fetchImpl, calls } = fakeKite();
    app = await buildApp({ db: await testDb(), config: loadConfig(KITE_ENV), fetch: fetchImpl, logger: false });

    const { kiteUrl, cb, sid } = await signIn(fetchImpl);
    expect(kiteUrl.host).toBe("kite.zerodha.com");
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe("/"); // relative: works on any domain the app is served from
    expect(sid).toBeTruthy();

    const res = await app.inject({ url: "/api/portfolio", cookies: { kairo_sid: sid! } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.holdings[0].quantity).toBe(3); // quantity + t1_quantity
    expect(body.summary.equity.current).toBe(360);
    expect(calls.find((c) => c.path === "/portfolio/holdings")?.auth).toBe("token key:tok");
    // The legal name is shortened for display: no father's name in the UI.
    const me = (await app.inject({ url: "/api/auth/me", cookies: { kairo_sid: sid! } })).json();
    expect(me.user.name).toBe("Bhavy Ladani");
  });

  it("rejects requests without a session", async () => {
    app = await buildApp({ db: await testDb(), config: loadConfig(KITE_ENV), fetch: fakeKite().fetchImpl, logger: false });
    expect((await app.inject("/api/portfolio")).statusCode).toBe(401);
    expect((await app.inject("/api/auth/me")).statusCode).toBe(401);
  });

  it("rejects a mismatched oauth state", async () => {
    const { fetchImpl, calls } = fakeKite();
    app = await buildApp({ db: await testDb(), config: loadConfig(KITE_ENV), fetch: fetchImpl, logger: false });
    const { cb, sid } = await signIn(fetchImpl, "forged-state");
    expect(cb.headers.location).toContain("error=state");
    expect(sid).toBeUndefined();
    expect(calls.some((c) => c.path === "/session/token")).toBe(false);
  });

  it("rejects and revokes a token for any other Kite user", async () => {
    const { fetchImpl, calls } = fakeKite({ "POST /session/token": () => ok({ user_id: "ZZ9999", access_token: "t2" }) });
    app = await buildApp({ db: await testDb(), config: loadConfig(KITE_ENV), fetch: fetchImpl, logger: false });
    const { cb, sid } = await signIn(fetchImpl);
    expect(cb.headers.location).toContain("error=forbidden");
    expect(sid).toBeUndefined();
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/session/token")).toBe(true);
  });

  it("keeps the Kairo session when Kite rejects the token, and asks to reconnect", async () => {
    const { fetchImpl } = fakeKite({
      "GET /portfolio/holdings": () => ({ status: "error", message: "expired", error_type: "TokenException" }),
    });
    app = await buildApp({ db: await testDb(), config: loadConfig(KITE_ENV), fetch: fetchImpl, logger: false });
    const { sid } = await signIn(fetchImpl);
    // No snapshot saved yet, so there is nothing to fall back on.
    const res = await app.inject({ url: "/api/portfolio", cookies: { kairo_sid: sid! } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("broker_disconnected");
    const me = await app.inject({ url: "/api/auth/me", cookies: { kairo_sid: sid! } });
    expect(me.statusCode).toBe(200);
    expect(me.json().kite).toEqual({ connected: false, expiresAt: null });
  });

  it("returns 502 when Kite changes a field type", async () => {
    const { fetchImpl } = fakeKite({ "GET /portfolio/holdings": () => ok([{ tradingsymbol: 1 }]) });
    app = await buildApp({ db: await testDb(), config: loadConfig(KITE_ENV), fetch: fetchImpl, logger: false });
    const { sid } = await signIn(fetchImpl);
    const res = await app.inject({ url: "/api/portfolio", cookies: { kairo_sid: sid! } });
    expect(res.statusCode).toBe(502);
  });
});

describe("session storage", () => {
  it("stores only a hash of the session id and an encrypted token", async () => {
    const db = await testDb();
    const { fetchImpl } = fakeKite();
    app = await buildApp({ db, config: loadConfig(KITE_ENV), fetch: fetchImpl, logger: false });
    const { sid } = await signIn(fetchImpl);
    const [row] = await db.query<{ id_hash: string; token_enc: string }>("select id_hash, token_enc from sessions");
    const raw = app.unsignCookie(sid!).value!;
    expect(row!.id_hash).not.toContain(raw);
    expect(row!.token_enc).not.toContain("tok");
    // A second app instance (another serverless invocation) sees the same session.
    const other = await buildApp({ db, config: loadConfig(KITE_ENV), fetch: fetchImpl, logger: false });
    expect((await other.inject({ url: "/api/auth/me", cookies: { kairo_sid: sid! } })).statusCode).toBe(200);
    await other.close();
  });

  it("treats a token sealed with another secret as disconnected, not as a valid token", async () => {
    const db = await testDb();
    const { fetchImpl } = fakeKite();
    app = await buildApp({ db, config: loadConfig(KITE_ENV), fetch: fetchImpl, logger: false });
    const { sid } = await signIn(fetchImpl);
    // In practice rotating SESSION_SECRET also invalidates every cookie signature;
    // re-signing here isolates the token path: it must never decrypt to garbage.
    const rotated = await buildApp({ db, config: loadConfig({ ...KITE_ENV, SESSION_SECRET: "y".repeat(32) }), fetch: fetchImpl, logger: false });
    const resigned = rotated.signCookie(app.unsignCookie(sid!).value!);
    const me = await rotated.inject({ url: "/api/auth/me", cookies: { kairo_sid: resigned } });
    expect(me.json().kite.connected).toBe(false);
    await rotated.close();
  });
});

describe("long sessions and holdings snapshots", () => {
  const DAY = 86_400_000;
  const T0 = Date.parse("2026-11-20T04:00:00Z"); // 09:30 IST

  /** A Kite whose holdings endpoint can be switched to "token expired". */
  function switchableKite() {
    const state = { expired: false };
    const kite = fakeKite({
      "GET /portfolio/holdings": () =>
        state.expired
          ? { status: "error", message: "expired", error_type: "TokenException" }
          : ok([{ tradingsymbol: "INFY", exchange: "NSE", isin: "INE009A01021", quantity: 2, t1_quantity: 1, average_price: 100, last_price: 120, close_price: 110 }]),
    });
    return { ...kite, state };
  }

  async function reconnect(sid: string) {
    const login = await app.inject({ url: "/api/auth/login", cookies: { kairo_sid: sid } });
    const state = new URLSearchParams(new URL(login.headers.location as string).searchParams.get("redirect_params")!).get("state")!;
    return app.inject({
      url: `/api/auth/callback?status=success&request_token=rt2&state=${state}`,
      cookies: { kairo_oauth_state: cookieOf(login, "kairo_oauth_state")!, kairo_sid: sid },
    });
  }

  it("serves the saved snapshot after the token expires, revalued at the latest NSE close", async () => {
    const db = await testDb();
    const { fetchImpl, state, calls } = switchableKite();
    app = await buildApp({ db, config: loadConfig(KITE_ENV), fetch: fetchImpl, logger: false });
    const { sid } = await signIn(fetchImpl);

    const live = (await app.inject({ url: "/api/portfolio", cookies: { kairo_sid: sid! } })).json();
    expect(live).toMatchObject({ source: "live", snapshotAt: null });

    // A newer NSE close arrives after the snapshot was taken.
    await db.query(
      `insert into daily_bars (symbol, date, isin, open, high, low, close, prev_close, volume, turnover)
       values ('INFY', current_date + 1, 'INE009A01021', 125, 131, 124, 130, 120, 1000, 130000)`,
    );
    state.expired = true;
    const res = await app.inject({ url: "/api/portfolio", cookies: { kairo_sid: sid! } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe("snapshot");
    expect(body.snapshotAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.holdings[0]).toMatchObject({ symbol: "INFY", quantity: 3, lastPrice: 130, previousClose: 120 });

    // The token is now forgotten: later requests go straight to the snapshot.
    const before = calls.filter((c) => c.path === "/portfolio/holdings").length;
    await app.inject({ url: "/api/portfolio", cookies: { kairo_sid: sid! } });
    expect(calls.filter((c) => c.path === "/portfolio/holdings").length).toBe(before);
  });

  it("reconnects Kite onto the same session instead of creating a new one", async () => {
    const db = await testDb();
    const { fetchImpl, state } = switchableKite();
    app = await buildApp({ db, config: loadConfig(KITE_ENV), fetch: fetchImpl, logger: false });
    const { sid } = await signIn(fetchImpl);
    await app.inject({ url: "/api/portfolio", cookies: { kairo_sid: sid! } });
    state.expired = true;
    await app.inject({ url: "/api/portfolio", cookies: { kairo_sid: sid! } });
    expect((await app.inject({ url: "/api/auth/me", cookies: { kairo_sid: sid! } })).json().kite.connected).toBe(false);

    state.expired = false;
    const cb = await reconnect(sid!);
    expect(cb.headers.location).toBe("/");
    expect(cookieOf(cb, "kairo_sid")).toBeUndefined(); // same session, no new cookie
    expect((await app.inject({ url: "/api/auth/me", cookies: { kairo_sid: sid! } })).json().kite.connected).toBe(true);
    const [n] = await db.query<{ n: number }>("select count(*)::int as n from sessions");
    expect(n!.n).toBe(1);
  });

  it("lasts 30 days, slides while used, and outlives the daily Kite token", async () => {
    let now = T0;
    const { fetchImpl } = fakeKite();
    app = await buildApp({ db: await testDb(), config: loadConfig(KITE_ENV), fetch: fetchImpl, now: () => now, logger: false });
    const { sid } = await signIn(fetchImpl);
    const me = () => app.inject({ url: "/api/auth/me", cookies: { kairo_sid: sid! } });

    now = T0 + DAY; // next morning: Kite token gone, Kairo session fine
    const day1 = await me();
    expect(day1.statusCode).toBe(200);
    expect(day1.json().kite.connected).toBe(false);
    expect(cookieOf(day1, "kairo_sid")).toBeDefined(); // renewed: cookie re-issued with a later expiry

    now = T0 + 29 * DAY;
    expect((await me()).statusCode).toBe(200); // renewed again on use
    now = T0 + 58 * DAY;
    expect((await me()).statusCode).toBe(200); // still within 30 days of the last use
    now = T0 + 89 * DAY;
    expect((await me()).statusCode).toBe(401); // 31 idle days later: expired
  });

  it("signs out everywhere", async () => {
    const { fetchImpl } = fakeKite();
    app = await buildApp({ db: await testDb(), config: loadConfig(KITE_ENV), fetch: fetchImpl, logger: false });
    const a = (await signIn(fetchImpl)).sid!;
    const b = (await signIn(fetchImpl)).sid!;
    expect((await app.inject({ method: "POST", url: "/api/auth/logout-all", cookies: { kairo_sid: a } })).statusCode).toBe(204);
    expect((await app.inject({ url: "/api/auth/me", cookies: { kairo_sid: b } })).statusCode).toBe(401);
  });
});

describe("public demo", () => {
  it("is read-only in production", async () => {
    app = await buildApp({ db: await testDb(), config: loadConfig({ NODE_ENV: "production" }), logger: false });
    const res = await app.inject({ method: "POST", url: "/api/watchlist", payload: { symbol: "TCS" } });
    expect(res.statusCode).toBe(403);
  });
});

describe("cron route", () => {
  it("is absent without a secret and rejects a wrong token", async () => {
    app = await buildApp({ db: await testDb(), config: loadConfig({ NODE_ENV: "test" }), logger: false });
    expect((await app.inject("/api/cron/eod")).statusCode).toBe(404);
    await app.close();
    app = await buildApp({ db: await testDb(), config: loadConfig({ NODE_ENV: "test", CRON_SECRET: "s".repeat(20) }), logger: false });
    expect((await app.inject({ url: "/api/cron/eod", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
  });
});

describe("tradebook import", () => {
  const HEADER = "symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time";
  const CSV = `${HEADER}
INFY,INE009A01021,2025-01-10,NSE,EQ,EQ,buy,false,2,1500,T1,O1,2025-01-10T09:20:00
INFY,INE009A01021,2025-02-10,BSE,EQ,A,buy,false,1,1600,T2,O2,2025-02-10T09:20:00
INFY,INE009A01021,2025-06-10,NSE,EQ,EQ,sell,false,1,1700,T3,O3,2025-06-10T10:00:00
`;
  const upload = (body: string, sid: string) =>
    app.inject({ method: "POST", url: "/api/trades/import", headers: { "content-type": "text/csv", "x-filename": "tradebook.csv" }, payload: body, cookies: { kairo_sid: sid } });

  it("imports idempotently, matches with Kite holdings and reports gains", async () => {
    const { fetchImpl } = fakeKite();
    app = await buildApp({ db: await testDb(), config: loadConfig(KITE_ENV), fetch: fetchImpl, now: () => Date.parse("2026-01-15T10:00:00Z"), logger: false });
    const { sid } = await signIn(fetchImpl);

    const first = await upload(CSV, sid!);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ parsed: 3, inserted: 3, duplicates: 0 });
    expect((await upload(CSV, sid!)).json()).toMatchObject({ inserted: 0, duplicates: 3 });

    const { summary, sample } = (await app.inject({ url: "/api/trades/summary", cookies: { kairo_sid: sid! } })).json();
    expect(sample).toBe(false);
    expect(summary.coverage).toEqual({ from: "2025-01-10", to: "2025-06-10", trades: 3 });
    expect(summary.realized).toBe(200); // sold 1 of the oldest lot: 1700 − 1500
    const infy = summary.positions.find((p: { key: string }) => p.key === "INFY");
    // BSE and NSE buys form one position; Kite's fake LTP is 120 and it reports 3 shares.
    expect(infy).toMatchObject({ openQuantity: 2, currentPrice: 120, brokerQuantity: 3 });
    expect(summary.mismatches).toEqual([{ key: "INFY", tradebook: 2, broker: 3 }]);
  });

  it("rejects files that are not a tradebook, and requires a session", async () => {
    const { fetchImpl } = fakeKite();
    app = await buildApp({ db: await testDb(), config: loadConfig(KITE_ENV), fetch: fetchImpl, logger: false });
    expect((await app.inject({ method: "POST", url: "/api/trades/import", headers: { "content-type": "text/csv" }, payload: CSV })).statusCode).toBe(401);
    const { sid } = await signIn(fetchImpl);
    const bad = await upload("name,amount\nfoo,1\n", sid!);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/Missing columns/);
  });
});

describe("public demo (read-only database)", () => {
  it("never serves personal data and shows a sample tradebook", async () => {
    const db = await testDb();
    // Personal rows that must stay invisible to the demo.
    await db.query("insert into watchlist_items (symbol) values ('SECRET')");
    await db.query("insert into alerts (symbol, kind, threshold) values ('SECRET', 'price_above', 1)");
    app = await buildApp({ db, config: loadConfig({ NODE_ENV: "production", DATABASE_READ_ONLY: "true" }), logger: false });

    expect((await app.inject("/api/auth/me")).json()).toMatchObject({ mode: "demo", readOnly: true });
    expect((await app.inject("/api/watchlist")).json()).toEqual({ items: [] });
    expect((await app.inject("/api/alerts")).json()).toMatchObject({ alerts: [], events: [] });
    expect((await app.inject("/api/screens")).json()).toEqual({ screens: [] });
    const t = (await app.inject("/api/trades/summary")).json();
    expect(t.sample).toBe(true);
    expect(t.summary.mismatches).toEqual([]); // sample lots reconcile with the demo holdings
    expect((await app.inject({ method: "POST", url: "/api/trades/import", headers: { "content-type": "text/csv" }, payload: "x" })).statusCode).toBe(403);
    // No snapshot yet: a read-only reader serves an empty overview instead of trying to compute one.
    expect((await app.inject("/api/market/overview")).json()).toMatchObject({ asOf: null });
  });
});

describe("plan", () => {
  const plan = {
    version: 1,
    income: 100000,
    essentials: 40000,
    lifestyle: 20000,
    emis: 0,
    emergency: { months: 6, saved: 0 },
    insurance: { term: true, health: true },
    goals: [{ id: "g", name: "Home", costToday: 2000000, targetYear: 2032, priority: "must" }],
    risk: [],
    assumptions: { inflation: 0.06, equity: 0.11, debt: 0.07, gold: 0.07 },
  };

  it("saves per user with a conflict check, and reports today's allocation", async () => {
    const { fetchImpl } = fakeKite();
    app = await buildApp({ db: await testDb(), config: loadConfig(KITE_ENV), fetch: fetchImpl, logger: false });
    expect((await app.inject("/api/plan")).statusCode).toBe(401);
    const sid = (await signIn(fetchImpl)).sid!;
    const cookies = { kairo_sid: sid };

    const empty = (await app.inject({ url: "/api/plan", cookies })).json();
    expect(empty).toMatchObject({ plan: null, updatedAt: null, sample: false });
    expect(empty.actual.total).toBe(360 + 1000); // 3 INFY (incl. T1) at 120, plus cash as debt

    const bad = await app.inject({ method: "PUT", url: "/api/plan", cookies, payload: { plan: { ...plan, income: -1 }, updatedAt: null } });
    expect(bad.statusCode).toBe(400);

    const first = await app.inject({ method: "PUT", url: "/api/plan", cookies, payload: { plan: { ...plan, goals: [{ ...plan.goals[0], saved: 0 }] }, updatedAt: null } });
    expect(first.statusCode).toBe(200);
    const v1 = first.json().updatedAt as string;

    // A second "first save" (another tab that read before v1) is refused.
    const stale = await app.inject({ method: "PUT", url: "/api/plan", cookies, payload: { plan: { ...plan, goals: [] }, updatedAt: null } });
    expect(stale.statusCode).toBe(409);

    const second = await app.inject({ method: "PUT", url: "/api/plan", cookies, payload: { plan: { ...plan, income: 120000, goals: [] }, updatedAt: v1 } });
    expect(second.statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: "/api/plan", cookies, payload: { plan: { ...plan, goals: [] }, updatedAt: v1 } })).statusCode).toBe(409);

    const saved = (await app.inject({ url: "/api/plan", cookies })).json();
    expect(saved.plan.income).toBe(120000);
    expect(saved.updatedAt).toBe(second.json().updatedAt);
  });

  it("shows the public demo a sample plan it cannot save", async () => {
    app = await buildApp({ db: await testDb(), config: loadConfig({ NODE_ENV: "production", DATABASE_READ_ONLY: "true" }), logger: false });
    const res = (await app.inject("/api/plan")).json();
    expect(res.sample).toBe(true);
    expect(res.plan.goals.length).toBeGreaterThan(0);
    expect(res.actual.total).toBeGreaterThan(0);
    expect((await app.inject({ method: "PUT", url: "/api/plan", payload: { plan: res.plan, updatedAt: null } })).statusCode).toBe(403);
  });
});
