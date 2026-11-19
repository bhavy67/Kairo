import { describe, expect, it } from "vitest";
import { GLOBAL_SERIES, overnightCues, parseEcbRates, parseFredCsv, toQuote } from "./global.js";

describe("parseFredCsv", () => {
  it("reads the current header and skips missing values", () => {
    expect(parseFredCsv("observation_date,SP500\n2026-11-17,7340.53\n2026-11-18,.\n2026-11-19,\n2026-11-20,7323.63\n")).toEqual([
      { date: "2026-11-17", value: 7340.53 },
      { date: "2026-11-20", value: 7323.63 },
    ]);
  });

  it("accepts the older DATE header", () => {
    expect(parseFredCsv("DATE,DGS10\n2026-11-18,4.21\n")).toEqual([{ date: "2026-11-18", value: 4.21 }]);
  });
});

describe("parseEcbRates", () => {
  it("inverts INR-based rates and quotes JPY per 100", () => {
    const m = parseEcbRates({ rates: { "2026-11-19": { USD: 0.01071, JPY: 1.6 }, "2026-11-18": { USD: 0.0107 } } }, ["USD", "JPY"]);
    expect(m.get("USD")!.map((p) => p.date)).toEqual(["2026-11-18", "2026-11-19"]);
    expect(m.get("USD")![1]!.value).toBeCloseTo(93.37, 2);
    expect(m.get("JPY")![0]!.value).toBeCloseTo(62.5, 4);
  });

  it("tolerates a malformed payload", () => {
    expect(parseEcbRates(null, ["USD"]).get("USD")).toEqual([]);
  });
});

describe("quotes and cues", () => {
  const s = (id: string) => GLOBAL_SERIES.find((x) => x.id === id)!;

  it("reports yields in percentage points and everything else as a fraction", () => {
    expect(toQuote(s("us10y"), [{ date: "a", value: 4.2 }, { date: "b", value: 4.27 }])!.change).toBeCloseTo(0.07);
    expect(toQuote(s("sp500"), [{ date: "a", value: 100 }, { date: "b", value: 99 }])!.change).toBeCloseTo(-0.01);
    expect(toQuote(s("sp500"), [])).toBeNull();
  });

  it("writes one descriptive sentence", () => {
    const quotes = [
      toQuote(s("sp500"), [{ date: "a", value: 100 }, { date: "b", value: 99.5 }])!,
      toQuote(s("nasdaq"), [{ date: "a", value: 100 }, { date: "b", value: 99 }])!,
      toQuote(s("brent"), [{ date: "a", value: 72 }, { date: "b", value: 73.2 }])!,
      toQuote(s("usdinr"), [{ date: "a", value: 93.44 }, { date: "b", value: 93.3 }])!,
    ];
    expect(overnightCues(quotes)).toBe("US stocks fell: S&P 500 -0.5%, Nasdaq -1.0%. Brent $73.2 (+1.7%). ₹93.30 per dollar, rupee stronger.");
    expect(overnightCues([])).toBeNull();
  });

  it("says mixed when the indices disagree, and omits negligible moves", () => {
    const quotes = [
      toQuote(s("sp500"), [{ date: "a", value: 100 }, { date: "b", value: 99.77 }])!,
      toQuote(s("nasdaq"), [{ date: "a", value: 100 }, { date: "b", value: 100.42 }])!,
      toQuote(s("brent"), [{ date: "a", value: 92.9 }, { date: "b", value: 92.94 }])!,
    ];
    expect(overnightCues(quotes)).toBe("US stocks were mixed: S&P 500 -0.2%, Nasdaq +0.4%. Brent $92.9.");
  });
});
