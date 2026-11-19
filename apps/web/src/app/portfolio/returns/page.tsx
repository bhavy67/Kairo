"use client";

import { SymbolLink } from "@/components/SymbolLink";
import type { PositionSummary, Realized } from "@kairo/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Change } from "@/components/Change";
import { SortableTable, type Column } from "@/components/SortableTable";
import { ErrorCard, Loading } from "@/components/States";
import { api, ApiError } from "@/lib/api";
import { longDate, money, money2, percent, qty } from "@/lib/format";

const signedMoney = (v: number) => <Change value={v} format={money} />;
const xirrCell = (v: number | null) => (v === null ? "–" : <Change value={v} format={(x) => percent(x)} />);

const POSITION_COLUMNS: Column<PositionSummary>[] = [
  { key: "symbol", label: "Stock", sortValue: (p) => p.symbol, render: (p) => <SymbolLink symbol={p.key}>{p.symbol}</SymbolLink> },
  { key: "qty", label: "Open qty", sortValue: (p) => p.openQuantity, render: (p) => qty(p.openQuantity) },
  { key: "avg", label: "Avg cost", render: (p) => (p.avgCost === null ? "–" : money2(p.avgCost)) },
  { key: "value", label: "Value", sortValue: (p) => p.currentValue ?? 0, render: (p) => (p.currentValue === null ? "–" : money(p.currentValue)) },
  { key: "unreal", label: "Unrealised", sortValue: (p) => p.unrealized ?? 0, render: (p) => (p.unrealized === null ? "–" : signedMoney(p.unrealized)) },
  { key: "real", label: "Realised", sortValue: (p) => p.realized, render: (p) => (p.realized === 0 ? "–" : signedMoney(p.realized)) },
  { key: "xirr", label: "XIRR", sortValue: (p) => p.xirr ?? -Infinity, render: (p) => xirrCell(p.xirr) },
];

const TERM = { intraday: "Intraday", short: "Short-term", long: "Long-term" } as const;
const REALIZED_COLUMNS: Column<Realized>[] = [
  { key: "key", label: "Stock", sortValue: (r) => r.key, render: (r) => <SymbolLink symbol={r.key} /> },
  { key: "sell", label: "Sold", sortValue: (r) => r.sellDate, render: (r) => longDate(r.sellDate) },
  { key: "qty", label: "Qty", render: (r) => qty(r.quantity) },
  { key: "buy", label: "Bought", render: (r) => <span className="sub">{longDate(r.buyDate)} · {money2(r.buyPrice)}</span> },
  { key: "price", label: "Sell price", render: (r) => money2(r.sellPrice) },
  { key: "term", label: "Type", render: (r) => <span className="sub">{TERM[r.term]}</span> },
  { key: "pnl", label: "P&L", sortValue: (r) => r.pnl, render: (r) => signedMoney(r.pnl) },
];

export default function Returns() {
  const q = useQuery({ queryKey: ["trades"], queryFn: api.trades });
  if (q.isPending) return <Loading rows={5} />;
  if (q.error) return <ErrorCard error={q.error} onRetry={() => void q.refetch()} />;
  const { summary: s, sample } = q.data;

  return (
    <div className="stack">
      <div className="page-head">
        <h2 className="sr">Returns</h2>
        <span className="muted">
          {s?.coverage ? `${s.coverage.trades} trades · ${longDate(s.coverage.from)} – ${longDate(s.coverage.to)}` : "From your Zerodha tradebook"}
        </span>
      </div>

      {sample && <p className="card muted" style={{ margin: 0 }}>Showing a sample tradebook. Sign in with your own account to import yours.</p>}
      {!sample && <Upload hasTrades={!!s} />}

      {s && (
        <>
          <section className="card hero" aria-label="Annualised return">
            <span className="hero-label">Annualised return (XIRR) on traded positions</span>
            <span className="hero-value">{s.xirr === null ? "–" : percent(s.xirr)}</span>
            <span className="muted">Before charges and dividends · open positions valued at today’s price</span>
          </section>

          <section className="tiles" aria-label="Totals">
            <Tile label="Invested (open lots)" value={money(s.invested)} />
            <Tile label="Current value" value={money(s.currentValue)} />
            <Tile label="Unrealised P&L" value={signedMoney(s.unrealized)} />
            <Tile label="Realised P&L" value={signedMoney(s.realized)} />
          </section>

          {(s.mismatches.length > 0 || s.unmatched.length > 0) && (
            <section className="card" role="status">
              <h2>Check these</h2>
              <ul className="notes">
                {s.mismatches.map((m) => (
                  <li key={m.key}>
                    <span className="sym">{m.key}</span>: the tradebook implies {qty(m.tradebook)} shares, the broker reports {qty(m.broker)}. Usually an IPO
                    allotment, a transfer in, or trades before the export’s start date.
                  </li>
                ))}
                {s.unmatched.map((u) => (
                  <li key={`${u.key}-${u.date}`}>
                    <span className="sym">{u.key}</span>: sold {qty(u.quantity)} on {longDate(u.date)} with no recorded purchase. Export an older tradebook to include it.
                  </li>
                ))}
              </ul>
            </section>
          )}

          {s.byFy.length > 0 && (
            <section className="card">
              <div className="page-head" style={{ marginBottom: 8 }}>
                <h2 style={{ margin: 0 }}>Realised gains by financial year</h2>
                <span className="muted">Long-term = held over 12 months</span>
              </div>
              <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Year</th><th>Short-term</th><th>Long-term</th><th>Intraday</th><th>Total</th></tr>
                </thead>
                <tbody>
                  {s.byFy.map((f) => (
                    <tr key={f.fy}>
                      <td>{f.fy}</td>
                      <td>{signedMoney(f.short)}</td>
                      <td>{signedMoney(f.long)}</td>
                      <td>{signedMoney(f.intraday)}</td>
                      <td>{signedMoney(f.short + f.long + f.intraday)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <p className="sub" style={{ marginBottom: 0 }}>
                For your records, not a tax computation: excludes charges, STT and the 31 Jan 2018 grandfathering of cost. Bonus shares are counted at zero cost from
                the allotment date.
              </p>
            </section>
          )}

          <section className="card">
            <h2>By stock</h2>
            <SortableTable caption="Positions from tradebook" rows={s.positions} columns={POSITION_COLUMNS} rowKey={(p) => p.key} initialSort={{ key: "value", dir: "desc" }} />
          </section>

          {s.recent.length > 0 && (
            <section className="card">
              <h2>Realised trades</h2>
              <SortableTable caption="Realised trades" rows={s.recent} columns={REALIZED_COLUMNS} rowKey={(r) => `${r.key}-${r.sellDate}-${r.buyDate}-${r.quantity}-${r.buyPrice}`} initialSort={{ key: "sell", dir: "desc" }} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
    </div>
  );
}

function Upload({ hasTrades }: { hasTrades: boolean }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["trades"] });
  const upload = useMutation({
    mutationFn: api.importTrades,
    onSuccess: (r) => {
      setResult(`${r.inserted} new trades imported${r.duplicates ? `, ${r.duplicates} already present` : ""}${r.skippedCount ? `, ${r.skippedCount} non-equity rows skipped` : ""}.`);
      if (input.current) input.current.value = "";
      void refresh();
    },
  });
  const clear = useMutation({ mutationFn: api.clearTrades, onSuccess: () => { setResult(null); void refresh(); } });

  return (
    <section className="card stack" aria-labelledby="import">
      <h2 id="import" style={{ margin: 0 }}>{hasTrades ? "Add trades" : "Import your tradebook"}</h2>
      <p className="muted" style={{ margin: 0 }}>
        Zerodha Console → Reports → Tradebook → Segment: Equity → pick a date range → Download CSV. Import as many files as you like; overlapping trades are
        recognised and skipped. The file goes only to your private database.
      </p>
      <div className="row">
        <input ref={input} type="file" accept=".csv,text/csv" aria-label="Tradebook CSV" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} disabled={upload.isPending} />
        {upload.isPending && <span className="muted">Importing…</span>}
        <span style={{ flex: 1 }} />
        {hasTrades && (
          <button
            className="btn-quiet"
            onClick={() => window.confirm("Delete all imported trades? You can import the files again afterwards.") && clear.mutate()}
          >
            Delete all trades
          </button>
        )}
      </div>
      {result && <p className="gain" role="status" style={{ margin: 0 }}>{result}</p>}
      {upload.error && <p className="loss" role="alert" style={{ margin: 0 }}>{upload.error instanceof ApiError ? upload.error.message : "Import failed."}</p>}
    </section>
  );
}
