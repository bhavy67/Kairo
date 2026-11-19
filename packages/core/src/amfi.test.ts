import { describe, expect, it } from "vitest";
import { indexByIsin, parseAmfiNav } from "./amfi.js";

const SAMPLE = `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date

Open Ended Schemes(Equity Scheme - Flexi Cap Fund)

Parag Parikh Mutual Fund

122639;INF879O01027;-;Parag Parikh Flexi Cap Fund - Direct Plan - Growth;92.1234;18-Nov-2026
100001;INF000A01011;INF000A01029;Some Fund - IDCW;15.5;18-Nov-2026
100002;-;-;Wound Up Fund;N.A.;01-Jan-2020
`;

describe("parseAmfiNav", () => {
  const rows = parseAmfiNav(SAMPLE);

  it("skips headers, section lines and N.A. NAVs", () => {
    expect(rows.map((r) => r.schemeCode)).toEqual(["122639", "100001"]);
  });

  it("parses nav, date and isins", () => {
    expect(rows[0]).toMatchObject({ nav: 92.1234, date: "2026-11-18", isins: ["INF879O01027"] });
    expect(rows[1]!.isins).toEqual(["INF000A01011", "INF000A01029"]);
  });

  it("indexes every isin of a scheme", () => {
    const idx = indexByIsin(rows);
    expect(idx.get("INF000A01029")?.schemeCode).toBe("100001");
  });
});
