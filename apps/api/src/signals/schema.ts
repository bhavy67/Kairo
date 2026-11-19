import { BOOLEAN_FIELDS, NUMERIC_FIELDS, type ScreenRule } from "@kairo/core";
import { z } from "zod";

const numeric = z.enum(Object.keys(NUMERIC_FIELDS) as [keyof typeof NUMERIC_FIELDS, ...(keyof typeof NUMERIC_FIELDS)[]]);
const flag = z.enum(Object.keys(BOOLEAN_FIELDS) as [keyof typeof BOOLEAN_FIELDS, ...(keyof typeof BOOLEAN_FIELDS)[]]);
const op = z.enum([">", ">=", "<", "<="]);

/**
 * Screen rules arrive as JSON from the browser and are stored as jsonb.
 * Fields are a closed whitelist, and rules are evaluated in TypeScript over
 * already-loaded rows: user input never becomes SQL.
 */
export const ScreenRuleSchema: z.ZodType<ScreenRule> = z.object({
  universe: z.enum(["NIFTY 50", "NIFTY 500"]),
  conditions: z
    .array(
      z.union([
        z.object({ field: numeric, op, value: z.number().finite() }).strict(),
        z.object({ field: numeric, op, other: numeric }).strict(),
        z.object({ flag }).strict(),
      ]),
    )
    .max(12),
  sort: z.object({ field: numeric, dir: z.enum(["asc", "desc"]) }),
  limit: z.number().int().min(1).max(200),
});

export const SaveScreenSchema = z.object({
  name: z.string().trim().min(1).max(60),
  rule: ScreenRuleSchema,
  alert: z.boolean().default(false),
});

export const AlertSchema = z
  .object({
    symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9&-]{1,20}$/),
    kind: z.enum(["price_above", "price_below", "move_pct", "cross_200dma"]),
    threshold: z.number().positive().finite().nullable().default(null),
  })
  .refine((a) => a.kind === "cross_200dma" || a.threshold !== null, { message: "threshold is required", path: ["threshold"] })
  .refine((a) => a.kind !== "move_pct" || (a.threshold ?? 0) < 1, { message: "move_pct threshold is a fraction, e.g. 0.05", path: ["threshold"] });
