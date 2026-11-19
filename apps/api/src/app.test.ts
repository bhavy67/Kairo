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
    "GET /user/profile": () => ok({ user_id: "AB1234", user_name: "Bhavy", broker: "ZERODHA" }),
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
    expect(cb.headers.location).toBe("http://localhost:3000/");
    expect(sid).toBeTruthy();

    const res = await app.inject({ url: "/api/portfolio", cookies: { kairo_sid: sid! } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.holdings[0].quantity).toBe(3); // quantity + t1_quantity
    expect(body.summary.equity.current).toBe(360);
    expect(calls.find((c) => c.path === "/portfolio/holdings")?.auth).toBe("token key:tok");
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

  it("drops the session when Kite says the token expired", async () => {
    const { fetchImpl } = fakeKite({
      "GET /portfolio/holdings": () => ({ status: "error", message: "expired", error_type: "TokenException" }),
    });
    app = await buildApp({ db: await testDb(), config: loadConfig(KITE_ENV), fetch: fetchImpl, logger: false });
    const { sid } = await signIn(fetchImpl);
    const res = await app.inject({ url: "/api/portfolio", cookies: { kairo_sid: sid! } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("session_expired");
    const me = await app.inject({ url: "/api/auth/me", cookies: { kairo_sid: sid! } });
    expect(me.statusCode).toBe(401);
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

  it("treats sessions sealed with another secret as signed out", async () => {
    const db = await testDb();
    const { fetchImpl } = fakeKite();
    app = await buildApp({ db, config: loadConfig(KITE_ENV), fetch: fetchImpl, logger: false });
    const { sid } = await signIn(fetchImpl);
    const rotated = await buildApp({ db, config: loadConfig({ ...KITE_ENV, SESSION_SECRET: "y".repeat(32) }), fetch: fetchImpl, logger: false });
    const raw = app.unsignCookie(sid!).value!;
    const resigned = rotated.signCookie(raw);
    expect((await rotated.inject({ url: "/api/auth/me", cookies: { kairo_sid: resigned } })).statusCode).toBe(401);
    await rotated.close();
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
