import { describe, expect, it } from "vitest";
import { nseDateParts, parseBhavcopy, parseConstituents, parseIndexClose } from "./nse.js";

const BHAV = `TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4
2026-11-18,2026-11-18,CM,NSE,STK,1594,INE009A01021,INFY,EQ,,,,,INFOSYS LIMITED,1600.00,1610.50,1580.00,1588.60,1589.00,1602.30,,1588.60,,,5234567,8312345678.90,123456,F1,1,,,,,
2026-11-18,2026-11-18,CM,NSE,STK,19078,IN0020200104,SGBJUN28,GB,,,,,2.5%GOLDBONDS2028SR-III,13400.00,13400.00,13179.00,13205.17,13195.00,13599.24,,13205.17,,,271,3588616.65,61,F1,1,,,,,
`;

describe("parseBhavcopy", () => {
  it("keeps equity series only and maps prices", () => {
    expect(parseBhavcopy(BHAV)).toEqual([
      { symbol: "INFY", isin: "INE009A01021", date: "2026-11-18", open: 1600, high: 1610.5, low: 1580, close: 1588.6, prevClose: 1602.3, volume: 5234567, turnover: 8312345678.9 },
    ]);
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
