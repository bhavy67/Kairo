import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { displayName } from "@kairo/core";
import { z } from "zod";
import { SESSION_COOKIE, setSessionCookie, type AppContext } from "../app.js";
import { loginUrl } from "../kite/client.js";

const STATE_COOKIE = "kairo_oauth_state";

const Callback = z.object({
  status: z.string(),
  request_token: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
});

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const authRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    const { config, kite, sessions } = ctx;
    const secure = config.NODE_ENV === "production";
    // Relative redirects: the browser resolves them against whatever domain it is on
    // (custom domain, vercel.app, localhost), so the session cookie and the landing
    // page are always on the same origin. No configured "own URL" to drift.
    const home = "/";
    const failed = (reason: string) => `/login?error=${reason}`;

    /** Sign in, or reconnect Kite on an existing session: the same Kite flow either way. */
    app.get("/login", async (_req, reply) => {
      if (!kite) return reply.redirect(home);
      const state = randomBytes(24).toString("base64url");
      // SameSite=Lax: the cookie must survive Kite's top-level redirect back to us.
      reply.setCookie(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure, path: "/api/auth", maxAge: 600, signed: true });
      return reply.redirect(loginUrl(config.KITE_API_KEY!, state));
    });

    app.get("/callback", async (req, reply) => {
      if (!kite) return reply.redirect(home);
      const q = Callback.safeParse(req.query);
      const raw = req.cookies[STATE_COOKIE];
      const expected = raw ? req.unsignCookie(raw) : null;
      reply.clearCookie(STATE_COOKIE, { path: "/api/auth" });

      if (!q.success || q.data.status !== "success" || !q.data.request_token) return reply.redirect(failed("denied"));
      if (!expected?.valid || !expected.value || !q.data.state || !safeEqual(expected.value, q.data.state)) {
        return reply.redirect(failed("state"));
      }

      const { access_token, user_id } = await kite.createSession(q.data.request_token, config.KITE_API_SECRET!);
      if (user_id !== config.KITE_ALLOWED_USER_ID) {
        req.log.warn({ user_id }, "rejected login from non-allowed Kite user");
        await kite.invalidateSession(access_token);
        return reply.redirect(failed("forbidden"));
      }

      // Reconnect: attach the fresh token to the session already in this browser.
      if (req.session && req.session.userId === user_id) {
        await sessions.attachKite(req.session.id, access_token);
        return reply.redirect(home);
      }

      const profile = await kite.profile(access_token);
      const session = await sessions.create({ userId: user_id, userName: profile.user_name, kiteToken: access_token });
      setSessionCookie(reply, session.id, session.expiresAt, secure);
      return reply.redirect(home);
    });

    app.get("/me", async (req, reply) => {
      // readOnly tells the UI to hide controls the public demo would reject anyway.
      if (!kite) return { authenticated: true, mode: "demo", readOnly: ctx.publicDemo, user: { id: "DEMO", name: "Demo Investor" }, kite: null };
      if (!req.session) return reply.status(401).send({ authenticated: false, mode: "kite" });
      const s = req.session;
      return {
        authenticated: true,
        mode: "kite",
        readOnly: false,
        // Legal name as Kite gives it, shortened for display (first name + surname).
        user: { id: s.userId, name: displayName(s.userName) },
        expiresAt: new Date(s.expiresAt).toISOString(),
        kite: { connected: s.kiteToken !== null, expiresAt: s.kiteExpiresAt ? new Date(s.kiteExpiresAt).toISOString() : null },
      };
    });

    app.post("/logout", async (req, reply) => {
      if (req.session) {
        if (req.session.kiteToken) await kite?.invalidateSession(req.session.kiteToken);
        await sessions.delete(req.session.id);
      }
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return reply.status(204).send();
    });

    /** Sign out on every device: ends all of this user's sessions. */
    app.post("/logout-all", async (req, reply) => {
      if (req.session) {
        if (req.session.kiteToken) await kite?.invalidateSession(req.session.kiteToken);
        await sessions.deleteForUser(req.session.userId);
      }
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return reply.status(204).send();
    });
  };
