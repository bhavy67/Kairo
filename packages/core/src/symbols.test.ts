import { describe, expect, it } from "vitest";
import { parseSymbolList } from "./symbols.js";

describe("parseSymbolList", () => {
  it("accepts the forms people paste and de-duplicates in order", () => {
    const { symbols, invalid } = parseSymbolList("NSE:INFY, tcs\nHDFCBANK-EQ\tRELIANCE.NS  infy\nM&M;BAJAJ-AUTO");
    expect(symbols).toEqual(["INFY", "TCS", "HDFCBANK", "RELIANCE", "M&M", "BAJAJ-AUTO"]);
    expect(invalid).toEqual([]);
  });

  it("reports tokens that cannot be symbols", () => {
    expect(parseSymbolList("INFY (buy) ₹1500").invalid).toEqual(["(buy)", "₹1500"]);
  });

  it("caps the list", () => {
    const r = parseSymbolList(Array.from({ length: 5 }, (_, i) => `S${i}`).join(" "), 3);
    expect(r).toMatchObject({ symbols: ["S0", "S1", "S2"], truncated: true });
  });
});
