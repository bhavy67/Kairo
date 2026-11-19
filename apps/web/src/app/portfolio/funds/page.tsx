"use client";

import { FundsTable } from "@/components/FundsTable";
import { ErrorCard, Loading } from "@/components/States";
import { money } from "@/lib/format";
import { usePortfolio } from "@/lib/usePortfolio";

export default function Funds() {
  const { data, error, isPending, refetch } = usePortfolio();
  if (isPending) return <Loading rows={4} />;
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />;
  return (
    <div className="stack">
      <div className="page-head">
        <h2 className="sr">Mutual funds</h2>
        <span className="muted">{data.funds.length} funds · {money(data.summary.funds.current)}</span>
      </div>
      <section className="card"><FundsTable rows={data.funds} /></section>
    </div>
  );
}
