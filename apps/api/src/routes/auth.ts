import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { displayName } from "@kairo/core";
import { z } from "zod";
import { SESSION_COOKIE, setSessionCookie, type AppContext } from "../app.js";
import { AppError } from "../errors.js";
import { loginUrl } from "../kite/client.js";

const STATE_COOKIE = "kairo_oauth_state";

/** A display name: letters, spaces and . ' - only, so it stays a name. Empty resets to the legal name. */
const NameBody = z.object({
  name: z
    .string()
    .trim()
    .max(40, "Keep the name under 40 characters.")
    .regex(/^[\p{L}\p{M} .'-]*$/u, "Use letters, spaces, dots, hyphens or apostrophes."),
});

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

      const profile = await kite.profile(access_token);
      const names = { userName: profile.user_name, userShort: profile.user_shortname };

      // Reconnect: attach the fresh token to the session already in this browser.
      if (req.session && req.session.userId === user_id) {
        await sessions.attachKite(req.session.id, access_token, names);
        return reply.redirect(home);
      }

      const session = await sessions.create({ userId: user_id, ...names, kiteToken: access_token });
      setSessionCookie(reply, session.id, session.expiresAt, secure);
      return reply.redirect(home);
    });

    app.get("/me", async (req, reply) => {
      // readOnly tells the UI to hide controls the public demo would reject anyway.
      if (!kite) return { authenticated: true, mode: "demo", readOnly: ctx.publicDemo, user: { id: "DEMO", name: "Demo Investor" }, kite: null };
      if (!req.session) return reply.status(401).send({ authenticated: false, mode: "kite" });
      const s = req.session;
      const [pref] = await ctx.db.query<{ display_name: string | null }>("select display_name from user_prefs where user_id = $1", [s.userId]);
      return {
        authenticated: true,
        mode: "kite",
        readOnly: false,
        // The name the user chose; otherwise the full legal name (see displayName).
        user: { id: s.userId, name: displayName(s.userName, pref?.display_name), legalName: displayName(s.userName) },
        expiresAt: new Date(s.expiresAt).toISOString(),
        kite: { connected: s.kiteToken !== null, expiresAt: s.kiteExpiresAt ? new Date(s.kiteExpiresAt).toISOString() : null },
      };
    });

    /** Set the name shown in the app. It belongs to the user, so it survives sign-outs and Kite reconnects. */
    app.put("/name", async (req) => {
      if (!kite || !req.session) throw new AppError(401, "unauthenticated", "Sign in with Kite to continue.");
      const body = NameBody.safeParse(req.body);
      if (!body.success) throw new AppError(400, "bad_request", body.error.issues[0]?.message ?? "Invalid name.");
      const chosen = body.data.name.replace(/\s+/g, " ") || null;
      await ctx.db.query(
        `insert into user_prefs (user_id, display_name, updated_at) values ($1, $2, now())
         on conflict (user_id) do update set display_name = excluded.display_name, updated_at = now()`,
        [req.session.userId, chosen],
      );
      return { name: displayName(req.session.userName, chosen) };
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
