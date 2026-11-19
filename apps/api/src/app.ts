import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { AmfiNavService } from "./amfi.js";
import type { Db } from "./db/db.js";
import { MarketRepo } from "./market/repo.js";
import type { Config } from "./config.js";
import { AppError } from "./errors.js";
import { KiteClient, type Fetch } from "./kite/client.js";
import { demoProvider } from "./providers/demo.js";
import { kiteProvider } from "./providers/kite.js";
import type { PortfolioProvider } from "./providers/types.js";
import { authRoutes } from "./routes/auth.js";
import { marketRoutes } from "./routes/market.js";
import { portfolioRoutes } from "./routes/portfolio.js";
import { SessionStore, type Session } from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    session: Session | undefined;
  }
}

export const SESSION_COOKIE = "kairo_sid";

export interface Deps {
  config: Config;
  db: Db;
  fetch?: Fetch;
  now?: () => number;
  logger?: boolean;
}

export interface AppContext {
  config: Config;
  kite: KiteClient | null;
  sessions: SessionStore;
  amfi: AmfiNavService;
  db: Db;
  market: MarketRepo;
  /** Throws 401 unless the request may see private data (always true in demo mode). */
  assertAccess(session: Session | undefined): void;
  /** Resolves the provider for a request, or throws 401 when a Kite session is required. */
  providerFor(session: Session | undefined): PortfolioProvider;
}

export async function buildApp({ config, db, fetch: fetchImpl = fetch, now = Date.now, logger = true }: Deps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger && {
      level: config.NODE_ENV === "production" ? "info" : "debug",
      // Never log tokens or cookies, even at debug level.
      redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
    },
    trustProxy: true,
  });

  await app.register(cookie, { secret: config.SESSION_SECRET ?? "demo-mode-cookie-secret-not-for-production" });

  const sessions = new SessionStore(now);
  const kite = config.DATA_MODE === "kite" ? new KiteClient(config.KITE_API_KEY!, fetchImpl) : null;
  const demo = demoProvider(now);

  const ctx: AppContext = {
    config,
    kite,
    sessions,
    amfi: new AmfiNavService(config.AMFI_NAV_URL, fetchImpl, now),
    db,
    market: new MarketRepo(db),
    assertAccess(session) {
      if (kite && !session) throw new AppError(401, "unauthenticated", "Sign in with Kite to continue.");
    },
    providerFor(session) {
      ctx.assertAccess(session);
      return kite ? kiteProvider(kite, session!.accessToken) : demo;
    },
  };

  app.decorateRequest("session", undefined);
  app.addHook("onRequest", async (req) => {
    const raw = req.cookies[SESSION_COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : null;
    req.session = unsigned?.valid ? sessions.get(unsigned.value ?? undefined) : undefined;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      // The broker rejected the token: drop our session so the UI routes to login.
      if (err.code === "session_expired" && req.session) {
        sessions.delete(req.session.id);
        reply.clearCookie(SESSION_COOKIE, { path: "/" });
      }
      if (err.statusCode >= 500) req.log.warn({ err }, err.message);
      return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: "bad_request", message: (err as Error).message });
    }
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: "internal", message: "Something went wrong." });
  });

  app.get("/api/health", async (_req, reply) => {
    try {
      await db.query("select 1");
      return { status: "ok", mode: config.DATA_MODE, db: "ok" };
    } catch {
      return reply.status(503).send({ status: "degraded", mode: config.DATA_MODE, db: "down" });
    }
  });
  await app.register(authRoutes(ctx), { prefix: "/api/auth" });
  await app.register(portfolioRoutes(ctx), { prefix: "/api" });
  await app.register(marketRoutes(ctx), { prefix: "/api" });

  return app;
}
