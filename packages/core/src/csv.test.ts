import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvRecords } from "./csv.js";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, embedded commas and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });
  it("keeps empty fields and skips blank lines", () => {
    expect(parseCsv("a,,c\n\n1,2,3")).toEqual([["a", "", "c"], ["1", "2", "3"]]);
  });
  it("maps records by trimmed header and strips a BOM", () => {
    expect(parseCsvRecords("﻿ Name ,Qty\nINFY,2\n")).toEqual([{ Name: "INFY", Qty: "2" }]);
  });
});
