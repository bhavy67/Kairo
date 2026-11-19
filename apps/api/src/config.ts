import { z } from "zod";

const Env = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().default(4000),
    HOST: z.string().default("127.0.0.1"),
    /** "demo" serves a fake portfolio with no broker; "kite" talks to Zerodha. */
    DATA_MODE: z.enum(["demo", "kite"]).default("demo"),
    /** Where the browser lands after login (the web app). */
    WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
    SESSION_SECRET: z.string().min(32).optional(),
    KITE_API_KEY: z.string().min(1).optional(),
    KITE_API_SECRET: z.string().min(1).optional(),
    /** Only this Kite user may sign in. The app is single-user by design. */
    KITE_ALLOWED_USER_ID: z.string().min(1).optional(),
    AMFI_NAV_URL: z.string().url().default("https://www.amfiindia.com/spages/NAVAll.txt"),
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
