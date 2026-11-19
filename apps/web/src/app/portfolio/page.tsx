"use client";

import { HoldingsTable } from "@/components/HoldingsTable";
import { ErrorCard, Loading } from "@/components/States";
import { money } from "@/lib/format";
import { usePortfolio } from "@/lib/usePortfolio";

export default function Holdings() {
  const { data, error, isPending, refetch } = usePortfolio();
  if (isPending) return <Loading rows={6} />;
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />;
  return (
    <div className="stack">
      <div className="page-head">
        <h2 className="sr">Holdings</h2>
        <span className="muted">{data.holdings.length} stocks · {money(data.summary.equity.current)}</span>
      </div>
      <section className="card"><HoldingsTable rows={data.holdings} /></section>
    </div>
  );
}
