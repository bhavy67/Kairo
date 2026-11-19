"use client";

import type { WatchItem } from "@kairo/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Change } from "@/components/Change";
import { SortableTable, type Column } from "@/components/SortableTable";
import { ErrorCard, Loading } from "@/components/States";
import { api, ApiError } from "@/lib/api";
import { big, money2, percent } from "@/lib/format";

export default function Watchlist() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["watchlist"], queryFn: api.watchlist });
  const [symbol, setSymbol] = useState("");
  const invalidate = () => qc.invalidateQueries({ queryKey: ["watchlist"] });
  const add = useMutation({
    mutationFn: api.addWatch,
    onSuccess: () => {
      setSymbol("");
      void invalidate();
    },
  });
  const remove = useMutation({ mutationFn: api.removeWatch, onSuccess: invalidate });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (symbol.trim()) add.mutate(symbol.trim().toUpperCase());
  };

  const columns: Column<WatchItem>[] = [
    { key: "symbol", label: "Symbol", sortValue: (w) => w.symbol, render: (w) => (<><div className="sym">{w.symbol}</div><div className="sub">{w.name ?? ""}</div></>) },
    { key: "industry", label: "Industry", sortValue: (w) => w.industry ?? "", render: (w) => <span className="sub">{w.industry ?? "–"}</span> },
    { key: "close", label: "Close", render: (w) => (w.close == null ? "–" : money2(w.close)) },
    { key: "chg", label: "Day", sortValue: (w) => w.changePct ?? 0, render: (w) => (w.changePct == null ? "–" : <Change value={w.changePct} format={(v) => percent(v)} />) },
    { key: "vol", label: "Volume", render: (w) => (w.volume == null ? "–" : big(w.volume)) },
    { key: "rsi", label: "RSI", sortValue: (w) => w.rsi14 ?? -1, render: (w) => (w.rsi14 == null ? "–" : w.rsi14.toFixed(0)) },
    { key: "dma", label: "vs 200d", sortValue: (w) => w.vsSma200 ?? -Infinity, render: (w) => (w.vsSma200 == null ? "–" : percent(w.vsSma200)) },
    { key: "m3", label: "3M", sortValue: (w) => w.ret63d ?? -Infinity, render: (w) => (w.ret63d == null ? "–" : <Change value={w.ret63d} format={(v) => percent(v)} />) },
    { key: "rm", label: "", render: (w) => <button className="btn-quiet" aria-label={`Remove ${w.symbol}`} onClick={() => remove.mutate(w.symbol)}>Remove</button> },
  ];

  return (
    <div className="stack">
      <div className="page-head"><h1>Watchlist</h1><span className="muted">NSE close prices</span></div>
      <form className="card row" onSubmit={submit}>
        <label htmlFor="sym" className="sr">NSE symbol</label>
        <input id="sym" className="input" placeholder="NSE symbol, e.g. TCS" value={symbol} onChange={(e) => setSymbol(e.target.value)} autoComplete="off" spellCheck={false} />
        <button className="btn btn-primary" disabled={add.isPending}>Add</button>
        {add.error && <span className="loss" role="alert">{add.error instanceof ApiError ? add.error.message : "Could not add."}</span>}
      </form>
      {q.isPending ? <Loading /> : q.error ? <ErrorCard error={q.error} onRetry={() => void q.refetch()} /> : (
        <section className="card">
          {q.data.items.length === 0 ? <p className="empty">Nothing on the watchlist yet.</p> : (
            <SortableTable caption="Watchlist" rows={q.data.items} columns={columns} rowKey={(w) => w.symbol} />
          )}
        </section>
      )}
    </div>
  );
}
