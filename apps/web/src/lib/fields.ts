import { BOOLEAN_FIELDS, NUMERIC_FIELDS, type NumericField, type ScreenRow } from "@kairo/core";
import { big, money2, percent, ratio } from "./format";

/** How each numeric field is entered and shown. The API always takes raw units (fractions, rupees). */
export const FIELD_UNITS: Record<NumericField, { unit: "%" | "₹" | "×" | "₹ Cr" | ""; scale: number }> = {
  close: { unit: "₹", scale: 1 },
  changePct: { unit: "%", scale: 0.01 },
  ret5d: { unit: "%", scale: 0.01 },
  ret21d: { unit: "%", scale: 0.01 },
  ret63d: { unit: "%", scale: 0.01 },
  rsi14: { unit: "", scale: 1 },
  volRatio: { unit: "×", scale: 1 },
  vsSma50: { unit: "%", scale: 0.01 },
  vsSma200: { unit: "%", scale: 0.01 },
  sma20: { unit: "₹", scale: 1 },
  sma50: { unit: "₹", scale: 1 },
  sma200: { unit: "₹", scale: 1 },
  fromHigh52: { unit: "%", scale: 0.01 },
  fromLow52: { unit: "%", scale: 0.01 },
  avgTurnover20: { unit: "₹ Cr", scale: 1e7 },
};

export const NUMERIC_OPTIONS = Object.entries(NUMERIC_FIELDS) as [NumericField, string][];
export const FLAG_OPTIONS = Object.entries(BOOLEAN_FIELDS) as [keyof typeof BOOLEAN_FIELDS, string][];

export function formatField(row: ScreenRow, field: NumericField): string {
  const v = row[field];
  if (v === null) return "–";
  const u = FIELD_UNITS[field].unit;
  if (u === "%") return percent(v);
  if (u === "₹") return money2(v);
  if (u === "×") return ratio(v);
  if (u === "₹ Cr") return `₹${big(v)}`;
  return v.toFixed(1);
}
