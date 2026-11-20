import { describe, expect, it } from "vitest";
import { nseDateParts, parseBhavcopy, parseConstituents, parseIndexClose } from "./nse.js";

const BHAV = `TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4
2026-11-18,2026-11-18,CM,NSE,STK,1594,INE009A01021,INFY,EQ,,,,,INFOSYS LIMITED,1600.00,1610.50,1580.00,1588.60,1589.00,1602.30,,1588.60,,,5234567,8312345678.90,123456,F1,1,,,,,
2026-11-18,2026-11-18,CM,NSE,STK,19078,IN0020200104,SGBJUN28,GB,,,,,2.5%GOLDBONDS2028SR-III,13400.00,13400.00,13179.00,13205.17,13195.00,13599.24,,13205.17,,,271,3588616.65,61,F1,1,,,,,
`;

describe("parseBhavcopy", () => {
  it("keeps equity and gold-bond series and maps prices", () => {
    const bars = parseBhavcopy(BHAV);
    expect(bars[0]).toEqual({ symbol: "INFY", isin: "INE009A01021", date: "2026-11-18", open: 1600, high: 1610.5, low: 1580, close: 1588.6, prevClose: 1602.3, volume: 5234567, turnover: 8312345678.9 });
    // Sovereign Gold Bonds (series GB): one unit is one gram of gold.
    expect(bars[1]).toMatchObject({ symbol: "SGBJUN28", close: 13205.17 });
    expect(bars).toHaveLength(2);
  });

  it("skips series Kairo does not track", () => {
    const debt = BHAV.replace(",SGBJUN28,GB,", ",GS2030,GS,");
    expect(parseBhavcopy(debt).map((b) => b.symbol)).toEqual(["INFY"]);
  });
});

describe("parseIndexClose", () => {
  const csv = `Index Name,Index Date,Open Index Value,High Index Value,Low Index Value,Closing Index Value,Points Change,Change(%),Volume,Turnover (Rs. Cr.),P/E,P/B,Div Yield
Nifty 50,18-11-2026,25323.15,25390.8,25141.8,25227.95,-159.45,-.63,299995485,29107.19,20.55,3.09,1.35
India VIX,18-11-2026,15.52,16.025,14.5875,15.57,0.05,.29,-,-,-,-,-
`;
  it("converts dates, percent and dashes", () => {
    const [n50, vix] = parseIndexClose(csv);
    expect(n50).toMatchObject({ name: "Nifty 50", date: "2026-11-18", close: 25227.95, pe: 20.55 });
    expect(n50!.changePct).toBeCloseTo(-0.0063);
    expect(vix).toMatchObject({ name: "India VIX", pe: null, pb: null });
  });
});

describe("parseConstituents", () => {
  it("maps the nifty list", () => {
    const csv = `Company Name,Industry,Symbol,Series,ISIN Code\n"Dr. Reddy's Laboratories Ltd.",Healthcare,DRREDDY,EQ,INE089A01031\n`;
    expect(parseConstituents(csv)).toEqual([{ symbol: "DRREDDY", isin: "INE089A01031", name: "Dr. Reddy's Laboratories Ltd.", industry: "Healthcare" }]);
  });
});

it("formats NSE file-name dates", () => {
  expect(nseDateParts("2026-11-08")).toEqual({ ymd: "20261108", dmy: "08112026" });
});

import { actionRatio, parseCorporateActions } from "./nse.js";

describe("corporate actions", () => {
  it("derives share ratios from purpose text", () => {
    expect(actionRatio("BONUS 1:1")).toBe(2);
    expect(actionRatio("BONUS 1:4")).toBe(1.25);
    expect(actionRatio("FACE VALUE SPLIT (SUB-DIVISION) - FROM RS 10/- PER SHARE TO RS 2/- PER SHARE")).toBe(5);
    expect(actionRatio("FACE VALUE SPLIT FROM RE 1 TO RE 0.50")).toBe(2);
    expect(actionRatio("CONSOLIDATION OF SHARES FROM RS 1 TO RS 10")).toBeCloseTo(0.1);
    expect(actionRatio("BONUS 2:1 AND FACE VALUE SPLIT FROM RS 10 TO RS 5")).toBe(6);
    // Real abbreviations seen in NSE's bc files:
    expect(actionRatio("FV SPLT FRM RS 5 TO RE 1")).toBe(5);
    expect(actionRatio("FV SPLT FRM RS10 TO RE1")).toBe(10);
    expect(actionRatio("FVSPLT FRM RS 10 TO RS 2")).toBe(5);
    expect(actionRatio("DEMERGER")).toBeNull();
    expect(actionRatio("INTERIM DIVIDEND - RS 5 PER SHARE")).toBeNull();
    expect(actionRatio("RIGHTS 1:5 @ PREMIUM RS 100")).toBeNull();
  });

  it("keeps every equity action once per symbol and date, joining same-day purposes", () => {
    const csv = `SERIES,SYMBOL,SECURITY,RECORD_DT,BC_STRT_DT,BC_END_DT,EX_DT,ND_STRT_DT,ND_END_DT,PURPOSE
N1,1003SCL31A,Sec Re NCD,2026-11-09,,,2026-11-09,,,INTEREST PAYMENT
BE,CONCORDBIO,Concord Biotech Limited,2026-11-04,,,2026-11-04,,,BONUS 1:1
EQ,CONCORDBIO,Concord Biotech Limited,2026-11-04,,,2026-11-04,,,BONUS 1:1
EQ,ITC,ITC Limited,13-Nov-2026,,,13-Nov-2026,,,INTERIM DIVIDEND - RS 6.50 PER SHARE
EQ,ABC,ABC Ltd,,,,12-Nov-2026,,,FACE VALUE SPLIT FROM RS 10 TO RS 1
EQ,ABC,ABC Ltd,,,,12-Nov-2026,,,BONUS 1:1
`;
    expect(parseCorporateActions(csv)).toEqual([
      { symbol: "CONCORDBIO", exDate: "2026-11-04", purpose: "BONUS 1:1", ratio: 2 },
      { symbol: "ITC", exDate: "2026-11-13", purpose: "INTERIM DIVIDEND - RS 6.50 PER SHARE", ratio: null },
      { symbol: "ABC", exDate: "2026-11-12", purpose: "FACE VALUE SPLIT FROM RS 10 TO RS 1 / BONUS 1:1", ratio: 20 },
    ]);
  });
});
