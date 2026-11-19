import { z } from "zod";

/**
 * Only the fields we use. Kite adds fields over time; z.object strips unknown
 * keys, so additions never break us, while a removed or retyped field fails
 * loudly at the boundary instead of rendering NaN in the UI.
 */

export const KiteHolding = z.object({
  tradingsymbol: z.string(),
  exchange: z.string(),
  isin: z.string(),
  quantity: z.number(),
  t1_quantity: z.number().default(0),
  average_price: z.number(),
  last_price: z.number(),
  close_price: z.number(),
});

export const KiteMfHolding = z.object({
  folio: z.string().nullable().transform((v) => v ?? ""),
  fund: z.string(),
  tradingsymbol: z.string(),
  quantity: z.number(),
  average_price: z.number(),
  last_price: z.number(),
  last_price_date: z.string().nullable().transform((v) => v ?? ""),
});

export const KitePosition = z.object({
  tradingsymbol: z.string(),
  exchange: z.string(),
  product: z.string(),
  quantity: z.number(),
  average_price: z.number(),
  last_price: z.number(),
  pnl: z.number(),
});

export const KitePositions = z.object({ net: z.array(KitePosition), day: z.array(KitePosition) });

export const KiteProfile = z.object({
  user_id: z.string(),
  user_name: z.string(),
  broker: z.string(),
});

export const KiteMargins = z.object({
  equity: z.object({
    net: z.number(),
    utilised: z.object({ debits: z.number() }),
  }),
});

export const KiteSession = z.object({
  user_id: z.string(),
  access_token: z.string(),
});

export const KiteEnvelope = z.discriminatedUnion("status", [
  z.object({ status: z.literal("success"), data: z.unknown() }),
  z.object({ status: z.literal("error"), message: z.string(), error_type: z.string() }),
]);
