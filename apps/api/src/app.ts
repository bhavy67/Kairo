import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { AmfiNavService } from "./amfi.js";
import type { Db } from "./db/db.js";
import { MarketRepo } from "./market/repo.js";
import type { Config } from "./config.js";
import { AppError } from "./errors.js";
import { KiteClient, type Fetch } from "./kite/client.js";
import { demoProvider } from "./providers/demo.js";
import { kiteProvider } from "./providers/kite.js";
import { resilientProvider } from "./providers/resilient.js";
import { SnapshotStore, snapshotProvider } from "./providers/snapshot.js";
import type { PortfolioProvider } from "./providers/types.js";
import { authRoutes } from "./routes/auth.js";
import { cronRoutes } from "./routes/cron.js";
import { marketRoutes } from "./routes/market.js";
import { signalsRoutes } from "./routes/signals.js";
import { tradesRoutes } from "./routes/trades.js";
import { stockRoutes } from "./routes/stocks.js";
import { globalRoutes } from "./routes/global.js";
import { telegramNotifier, type Notifier } from "./signals/notifier.js";
import { SignalsRepo } from "./signals/repo.js";
import { portfolioRoutes } from "./routes/portfolio.js";
import { planRoutes } from "./routes/plan.js";
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
  now: () => number;
  kite: KiteClient | null;
  sessions: SessionStore;
  snapshots: SnapshotStore;
  amfi: AmfiNavService;
  db: Db;
  market: MarketRepo;
  signals: SignalsRepo;
  /** Null when no channel is configured: alerts stay in-app only. */
  notifier: Notifier | null;
  /**
   * Public demo deployment: demo portfolio, real market data, a read-only DB role.
   * Personal data (watchlist, alerts, screens, trades) is never served from it.
   */
  publicDemo: boolean;
  /** Throws 401 unless the request may see private data (always true in demo mode). */
  assertAccess(session: Session | undefined): void;
  /** Like assertAccess, and also blocks writes on a public demo deployment. */
  assertWrite(session: Session | undefined): void;
  /**
   * The provider for a request: live Kite data when the token works, otherwise the
   * saved snapshot (401 without a session; 409 with neither token nor snapshot).
   */
  providerFor(session: Session | undefined): PortfolioProvider;
}

/** The Kairo session cookie: signed, HttpOnly, and lasting as long as the session itself. */
export function setSessionCookie(reply: FastifyReply, id: string, expiresAt: number, secure: boolean) {
  reply.setCookie(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    expires: new Date(expiresAt),
    signed: true,
  });
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

  const secret = config.SESSION_SECRET ?? "demo-mode-cookie-secret-not-for-production";
  await app.register(cookie, { secret });

  const sessions = new SessionStore(db, secret, now);
  const snapshots = new SnapshotStore(db);
  const amfi = new AmfiNavService(config.AMFI_NAV_URL, fetchImpl, now);
  const kite = config.DATA_MODE === "kite" ? new KiteClient(config.KITE_API_KEY!, fetchImpl) : null;
  const demo = demoProvider(now);

  const ctx: AppContext = {
    config,
    now,
    kite,
    sessions,
    snapshots,
    amfi,
    db,
    publicDemo: !kite && config.DATABASE_READ_ONLY,
    market: new MarketRepo(db, { readOnly: config.DATABASE_READ_ONLY }),
    signals: new SignalsRepo(db),
    notifier:
      config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID ? telegramNotifier(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID, fetchImpl) : null,
    assertAccess(session) {
      if (kite && !session) throw new AppError(401, "unauthenticated", "Sign in with Kite to continue.");
    },
    assertWrite(session) {
      ctx.assertAccess(session);
      if (!kite && config.NODE_ENV === "production") throw new AppError(403, "read_only", "The public demo is read-only.");
    },
    providerFor(session) {
      ctx.assertAccess(session);
      if (!kite) return demo;
      const s = session!;
      return resilientProvider(
        s.kiteToken ? kiteProvider(kite, s.kiteToken) : null,
        () => snapshotProvider(db, amfi, snapshots, s.userId, s.userName),
        () => sessions.dropKite(s.id),
      );
    },
  };

  app.decorateRequest("session", undefined);
  app.addHook("onRequest", async (req, reply) => {
    // Demo mode has no sessions; never touch the sessions table (a read-only role cannot see it).
    if (!kite) return;
    const raw = req.cookies[SESSION_COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : null;
    req.session = unsigned?.valid ? await sessions.get(unsigned.value ?? undefined) : undefined;
    // Sliding expiry: when the store extended the session, extend the cookie too.
    if (req.session?.renewed) setSessionCookie(reply, req.session.id, req.session.expiresAt, config.NODE_ENV === "production");
  });

  app.setErrorHandler(async (err, req, reply) => {
    if (err instanceof AppError) {
      // The broker rejected the token outside the snapshot-backed provider: forget the
      // token, keep the Kairo session, and tell the UI to offer a reconnect.
      if (err.code === "session_expired" && req.session) {
        await sessions.dropKite(req.session.id);
        return reply.status(409).send({ error: "broker_disconnected", message: "Kite session expired. Reconnect Kite to refresh." });
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
  await app.register(signalsRoutes(ctx), { prefix: "/api" });
  await app.register(tradesRoutes(ctx), { prefix: "/api" });
  await app.register(stockRoutes(ctx), { prefix: "/api" });
  await app.register(globalRoutes(ctx), { prefix: "/api" });
  await app.register(planRoutes(ctx), { prefix: "/api" });
  await app.register(cronRoutes(ctx, fetchImpl), { prefix: "/api/cron" });

  return app;
}
