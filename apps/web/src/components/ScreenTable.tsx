"use client";

import { SymbolLink } from "@/components/SymbolLink";
import type { ScreenRow } from "@kairo/core";
import { money2, percent, ratio } from "@/lib/format";
import { Change } from "./Change";
import { SortableTable, type Column } from "./SortableTable";

const pctCell = (v: number | null) => (v === null ? "–" : <Change value={v} format={(x) => percent(x)} />);

const COLUMNS: Column<ScreenRow>[] = [
  { key: "symbol", label: "Stock", sortValue: (r) => r.symbol, render: (r) => (<><SymbolLink symbol={r.symbol} /><div className="sub">{r.industry}</div></>) },
  { key: "close", label: "Close", sortValue: (r) => r.close, render: (r) => money2(r.close) },
  { key: "day", label: "Day", sortValue: (r) => r.changePct, render: (r) => pctCell(r.changePct) },
  { key: "m1", label: "1M", sortValue: (r) => r.ret21d ?? -Infinity, render: (r) => pctCell(r.ret21d) },
  { key: "m3", label: "3M", sortValue: (r) => r.ret63d ?? -Infinity, render: (r) => pctCell(r.ret63d) },
  { key: "rsi", label: "RSI", sortValue: (r) => r.rsi14 ?? -1, render: (r) => (r.rsi14 === null ? "–" : r.rsi14.toFixed(0)) },
  { key: "dma", label: "vs 200d", sortValue: (r) => r.vsSma200 ?? -Infinity, render: (r) => (r.vsSma200 === null ? "–" : percent(r.vsSma200)) },
  { key: "hi", label: "From 52w high", sortValue: (r) => r.fromHigh52 ?? -Infinity, render: (r) => (r.fromHigh52 === null ? "–" : percent(r.fromHigh52)) },
  { key: "vol", label: "Volume", sortValue: (r) => r.volRatio ?? 0, render: (r) => ratio(r.volRatio) },
];

export function ScreenTable({ rows, caption }: { rows: ScreenRow[]; caption: string }) {
  if (rows.length === 0) return <p className="empty">No stocks match today.</p>;
  return <SortableTable caption={caption} rows={rows} columns={COLUMNS} rowKey={(r) => r.symbol} />;
}
