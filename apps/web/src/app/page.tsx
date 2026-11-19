"use client";

import { Allocation } from "@/components/Allocation";
import { Change } from "@/components/Change";
import { HoldingsTable } from "@/components/HoldingsTable";
import { ErrorCard, Loading } from "@/components/States";
import { money, percent, timeIst } from "@/lib/format";
import { usePortfolio } from "@/lib/usePortfolio";
import Link from "next/link";

export default function Overview() {
  const { data, error, isPending, refetch, isFetching } = usePortfolio();
  if (isPending) return <Loading rows={4} />;
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />;

  const { summary: s, cash } = data;
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Overview</h1>
        <span className="muted" aria-live="polite">{isFetching ? "Refreshing…" : `As of ${timeIst(data.asOf)} IST`}</span>
      </div>

      <section className="card hero" aria-label="Portfolio value">
        <span className="hero-label">Portfolio value</span>
        <span className="hero-value">{money(s.total.current)}</span>
        <Change value={s.total.pnl} format={money} pct={percent(s.total.pnlPct)} />
      </section>

      <section className="tiles" aria-label="Key figures">
        <Tile label="Invested" value={money(s.total.invested)} />
        <Tile label="Today (equity)" value={<Change value={s.equity.dayChange} format={money} />} delta={percent(s.equity.dayChangePct)} />
        <Tile label="Equity P&L" value={<Change value={s.equity.pnl} format={money} />} delta={percent(s.equity.pnlPct)} />
        <Tile label="Funds P&L" value={<Change value={s.funds.pnl} format={money} />} delta={percent(s.funds.pnlPct)} />
        <Tile label="Cash available" value={money(cash.available)} />
      </section>

      <section className="card">
        <h2>Allocation</h2>
        <Allocation
          parts={[
            { label: "Equity", value: s.equity.current, color: "var(--series-1)" },
            { label: "Mutual funds", value: s.funds.current, color: "var(--series-2)" },
            { label: "Cash", value: cash.available, color: "var(--series-3)" },
          ]}
        />
      </section>

      <section className="card">
        <div className="page-head" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Top holdings</h2>
          <Link href="/holdings" className="muted">All holdings →</Link>
        </div>
        <HoldingsTable rows={data.holdings.slice(0, 5)} />
      </section>
    </div>
  );
}

function Tile({ label, value, delta }: { label: string; value: React.ReactNode; delta?: string }) {
  return (
    <div className="card">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {delta && <div className="tile-delta muted">{delta}</div>}
    </div>
  );
}
