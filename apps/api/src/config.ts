import { z } from "zod";

const Env = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().default(4000),
    HOST: z.string().default("127.0.0.1"),
    /** "demo" serves a fake portfolio with no broker; "kite" talks to Zerodha. */
    DATA_MODE: z.enum(["demo", "kite"]).default("demo"),
    SESSION_SECRET: z.string().min(32).optional(),
    KITE_API_KEY: z.string().min(1).optional(),
    KITE_API_SECRET: z.string().min(1).optional(),
    /** Only this Kite user may sign in. The app is single-user by design. */
    KITE_ALLOWED_USER_ID: z.string().min(1).optional(),
    AMFI_NAV_URL: z.string().url().default("https://portal.amfiindia.com/spages/NAVAll.txt"),
    /** Postgres URL. Unset: an embedded PGlite database under DATA_DIR (dev only). */
    DATABASE_URL: z.string().url().optional(),
    /** PEM of the database server's CA. Set it to verify the server certificate (verify-full). */
    DATABASE_CA_CERT: z.string().optional(),
    DATA_DIR: z.string().default(".data"),
    NSE_ARCHIVE_URL: z.string().url().default("https://nsearchives.nseindia.com"),
    /** Bearer token Vercel Cron (or any scheduler) sends to /api/cron/*. Unset disables the route. */
    CRON_SECRET: z.string().min(16).optional(),
    /** Telegram alerts: a bot token from @BotFather and your chat id. Both or neither. */
    TELEGRAM_BOT_TOKEN: z.string().min(20).optional(),
    TELEGRAM_CHAT_ID: z.string().min(1).optional(),
    /** Run the in-process EOD scheduler. Off in tests, one-off CLI runs and on Vercel (Cron drives it). */
    INGEST_SCHEDULE: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  })
  .superRefine((env, ctx) => {
    if (env.DATA_MODE !== "kite") return;
    for (const key of ["SESSION_SECRET", "KITE_API_KEY", "KITE_API_SECRET", "KITE_ALLOWED_USER_ID"] as const) {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when DATA_MODE=kite` });
    }
  });

export type Config = z.infer<typeof Env>;

/** Fail fast at boot with every problem listed, rather than at the first request. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
