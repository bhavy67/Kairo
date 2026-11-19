"use client";

import { SymbolLink } from "@/components/SymbolLink";
import type { AlertKind } from "@kairo/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { ErrorCard, Loading } from "@/components/States";
import { api, ApiError, type AlertView } from "@/lib/api";
import { longDate, money2 } from "@/lib/format";
import { useReadOnly } from "@/lib/useMe";

const KINDS: { kind: AlertKind; label: string; unit: "₹" | "%" | null }[] = [
  { kind: "price_above", label: "Closes above", unit: "₹" },
  { kind: "price_below", label: "Closes below", unit: "₹" },
  { kind: "move_pct", label: "Moves at least", unit: "%" },
  { kind: "cross_200dma", label: "Crosses its 200-day average", unit: null },
];

function describe(a: AlertView): string {
  const k = KINDS.find((x) => x.kind === a.kind)!;
  if (a.threshold === null) return k.label;
  return `${k.label} ${k.unit === "%" ? `${(a.threshold * 100).toFixed(1)}%` : money2(a.threshold)}`;
}

function AlertsInner() {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const q = useQuery({ queryKey: ["alerts"], queryFn: api.alerts });
  const [symbol, setSymbol] = useState(useSearchParams()?.get("symbol") ?? "");
  const [kind, setKind] = useState<AlertKind>("price_above");
  const [threshold, setThreshold] = useState("");
  const invalidate = () => qc.invalidateQueries({ queryKey: ["alerts"] });
  const add = useMutation({
    mutationFn: api.addAlert,
    onSuccess: () => {
      setSymbol("");
      setThreshold("");
      void invalidate();
    },
  });
  const remove = useMutation({ mutationFn: api.deleteAlert, onSuccess: invalidate });
  const unit = KINDS.find((k) => k.kind === kind)!.unit;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(threshold);
    add.mutate({ symbol: symbol.trim().toUpperCase(), kind, threshold: unit === null ? null : unit === "%" ? n / 100 : n });
  };

  if (q.isPending) return <Loading rows={4} />;
  if (q.error) return <ErrorCard error={q.error} onRetry={() => void q.refetch()} />;

  return (
    <div className="stack">
      <div className="page-head">
        <h2 className="sr">Alerts</h2>
        <span className="muted">Checked after each NSE close · {q.data.channel ? `sent to ${q.data.channel}` : "in-app only (no Telegram configured)"}</span>
      </div>

      {!readOnly && <form className="card row" onSubmit={submit}>
        <label htmlFor="a-sym" className="sr">NSE symbol</label>
        <input id="a-sym" className="input" style={{ maxWidth: 180 }} placeholder="Symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} autoComplete="off" spellCheck={false} required />
        <select className="select" aria-label="Condition" value={kind} onChange={(e) => setKind(e.target.value as AlertKind)}>
          {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        </select>
        {unit && (
          <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
            {unit === "₹" && <span className="muted">₹</span>}
            <input className="input num" aria-label="Threshold" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} required />
            {unit === "%" && <span className="muted">%</span>}
          </span>
        )}
        <button className="btn btn-primary" disabled={add.isPending}>Add alert</button>
        {add.error && <span className="loss" role="alert">{add.error instanceof ApiError ? add.error.message : "Could not add."}</span>}
      </form>}

      <section className="card">
        <h2>Rules</h2>
        {q.data.alerts.length === 0 ? (
          <p className="empty">No alerts yet. Saved screens with “Alert on new matches” also notify you.</p>
        ) : (
          <table>
            <tbody>
              {q.data.alerts.map((a) => (
                <tr key={a.id}>
                  <td><SymbolLink symbol={a.symbol} /></td>
                  <td style={{ textAlign: "left" }}>{describe(a)}</td>
                  <td><button className="btn-quiet" onClick={() => remove.mutate(a.id)} aria-label={`Delete alert for ${a.symbol}`}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="sub" style={{ marginBottom: 0 }}>Price alerts fire on the day the close crosses the level, not every day it stays beyond it.</p>
      </section>

      <section className="card">
        <h2>Recent events</h2>
        {q.data.events.length === 0 ? (
          <p className="empty">Nothing has fired yet.</p>
        ) : (
          <table>
            <tbody>
              {q.data.events.map((e) => (
                <tr key={e.id}>
                  <td className="sub">{longDate(e.date)}</td>
                  <td style={{ textAlign: "left", whiteSpace: "normal" }}>{e.message}</td>
                  <td className="sub">{e.source === "screen" ? "Screen" : "Alert"}{e.deliveredAt ? " · sent" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export default function Alerts() {
  return (
    <Suspense>
      <AlertsInner />
    </Suspense>
  );
}
