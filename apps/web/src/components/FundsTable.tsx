"use client";

import type { FundHoldingView } from "@kairo/core";
import { money, money2, percent, qty, share } from "@/lib/format";
import { Change } from "./Change";
import { SortableTable, type Column } from "./SortableTable";

const COLUMNS: Column<FundHoldingView>[] = [
  { key: "fund", label: "Fund", sortValue: (f) => f.fund, render: (f) => (<><div className="sym">{f.fund}</div><div className="sub">Folio {f.folio || "–"}</div></>) },
  { key: "units", label: "Units", render: (f) => qty(f.units) },
  { key: "avg", label: "Avg NAV", render: (f) => money2(f.averageNav) },
  { key: "nav", label: "NAV", render: (f) => (<><div>{money2(f.lastNav)}</div><div className="sub">{f.navDate}</div></>) },
  { key: "current", label: "Value", sortValue: (f) => f.current, render: (f) => money(f.current) },
  { key: "pnl", label: "P&L", sortValue: (f) => f.pnl, render: (f) => <Change value={f.pnl} format={money} pct={percent(f.pnlPct)} /> },
  { key: "weight", label: "Weight", sortValue: (f) => f.weight, render: (f) => share(f.weight) },
];

export function FundsTable({ rows }: { rows: FundHoldingView[] }) {
  if (rows.length === 0) return <p className="empty">No mutual fund holdings.</p>;
  return <SortableTable caption="Mutual fund holdings" rows={rows} columns={COLUMNS} rowKey={(f) => `${f.folio}:${f.isin}`} initialSort={{ key: "current", dir: "desc" }} />;
}
