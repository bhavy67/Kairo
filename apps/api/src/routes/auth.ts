import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { SESSION_COOKIE, type AppContext } from "../app.js";
import { loginUrl } from "../kite/client.js";

const STATE_COOKIE = "kairo_oauth_state";

const Callback = z.object({
  status: z.string(),
  request_token: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
});

const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

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

      const profile = await kite.profile(access_token);
      const session = await sessions.create({ userId: user_id, userName: profile.user_name, accessToken: access_token });
      reply.setCookie(SESSION_COOKIE, session.id, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        expires: new Date(session.expiresAt),
        signed: true,
      });
      return reply.redirect(home);
    });

    app.get("/me", async (req, reply) => {
      // readOnly tells the UI to hide controls the public demo would reject anyway.
      if (!kite) return { authenticated: true, mode: "demo", readOnly: ctx.publicDemo, user: { id: "DEMO", name: "Demo Investor" } };
      if (!req.session) return reply.status(401).send({ authenticated: false, mode: "kite" });
      return {
        authenticated: true,
        mode: "kite",
        readOnly: false,
        user: { id: req.session.userId, name: req.session.userName },
        expiresAt: new Date(req.session.expiresAt).toISOString(),
      };
    });

    app.post("/logout", async (req, reply) => {
      if (req.session) {
        await kite?.invalidateSession(req.session.accessToken);
        await sessions.delete(req.session.id);
      }
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return reply.status(204).send();
    });
  };
