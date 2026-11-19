"use client";

import { SymbolLink } from "@/components/SymbolLink";
import type { HoldingView } from "@kairo/core";
import { money, money2, percent, qty, share } from "@/lib/format";
import { Change } from "./Change";
import { SortableTable, type Column } from "./SortableTable";

const COLUMNS: Column<HoldingView>[] = [
  { key: "symbol", label: "Instrument", sortValue: (h) => h.symbol, render: (h) => (<><SymbolLink symbol={h.symbol} /><div className="sub">{h.exchange}</div></>) },
  { key: "qty", label: "Qty", render: (h) => qty(h.quantity) },
  { key: "avg", label: "Avg cost", render: (h) => money2(h.averagePrice) },
  { key: "ltp", label: "LTP", render: (h) => money2(h.lastPrice) },
  { key: "current", label: "Value", sortValue: (h) => h.current, render: (h) => money(h.current) },
  { key: "pnl", label: "P&L", sortValue: (h) => h.pnl, render: (h) => <Change value={h.pnl} format={money} pct={percent(h.pnlPct)} /> },
  { key: "day", label: "Day", sortValue: (h) => h.dayChangePct ?? 0, render: (h) => <Change value={h.dayChange} format={money} pct={percent(h.dayChangePct)} /> },
  { key: "weight", label: "Weight", sortValue: (h) => h.weight, render: (h) => share(h.weight) },
];

export function HoldingsTable({ rows }: { rows: HoldingView[] }) {
  if (rows.length === 0) return <p className="empty">No equity holdings.</p>;
  return (
    <SortableTable caption="Equity holdings" rows={rows} columns={COLUMNS} rowKey={(h) => `${h.exchange}:${h.symbol}`} initialSort={{ key: "current", dir: "desc" }} />
  );
}
