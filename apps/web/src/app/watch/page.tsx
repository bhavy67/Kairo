"use client";

import { SymbolLink } from "@/components/SymbolLink";
import type { WatchItem } from "@kairo/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Change } from "@/components/Change";
import { SortableTable, type Column } from "@/components/SortableTable";
import { ErrorCard, Loading } from "@/components/States";
import { api, ApiError } from "@/lib/api";
import { big, money2, percent } from "@/lib/format";
import { useReadOnly } from "@/lib/useMe";

export default function Watchlist() {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const q = useQuery({ queryKey: ["watchlist"], queryFn: api.watchlist });
  const [symbol, setSymbol] = useState("");
  const [pasting, setPasting] = useState(false);
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
    { key: "symbol", label: "Symbol", sortValue: (w) => w.symbol, render: (w) => (<><SymbolLink symbol={w.symbol} /><div className="sub">{w.name ?? ""}</div></>) },
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
      <div className="page-head"><h2 className="sr">Watchlist</h2><span className="muted">NSE close prices</span></div>
      {!readOnly && <form className="card row" onSubmit={submit}>
        <label htmlFor="sym" className="sr">NSE symbol</label>
        <input id="sym" className="input" placeholder="NSE symbol, e.g. TCS" value={symbol} onChange={(e) => setSymbol(e.target.value)} autoComplete="off" spellCheck={false} />
        <button className="btn btn-primary" disabled={add.isPending}>Add</button>
        {add.error && <span className="loss" role="alert">{add.error instanceof ApiError ? add.error.message : "Could not add."}</span>}
        <button type="button" className="btn-quiet" aria-expanded={pasting} onClick={() => setPasting((v) => !v)}>
          {pasting ? "Close" : "Paste a list"}
        </button>
      </form>}
      {!readOnly && pasting && <PasteList onDone={invalidate} />}
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

/** Many symbols at once: copied from Kite's marketwatch, a spreadsheet column, or typed. */
function PasteList({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const bulk = useMutation({
    mutationFn: api.addWatchBulk,
    onSuccess: (r) => {
      if (r.added.length) setText("");
      onDone();
    },
  });
  const r = bulk.data;
  return (
    <form
      className="card stack"
      style={{ gap: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) bulk.mutate(text);
      }}
    >
      <label htmlFor="paste" className="h3">Paste symbols</label>
      <textarea
        id="paste"
        className="textarea"
        rows={4}
        placeholder={"INFY, TCS, HDFCBANK\nor one per line. NSE:INFY and INFY-EQ work too."}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      <div className="row">
        <button className="btn btn-primary" disabled={bulk.isPending || !text.trim()}>Add all</button>
        <span className="sub">Up to 100 at a time. Kite’s API does not expose your Kite watchlists, so copy the symbols across.</span>
      </div>
      {r && (
        <p className="sub" role="status" style={{ margin: 0 }}>
          {r.added.length > 0 && <span className="gain">Added {r.added.join(", ")}. </span>}
          {r.already.length > 0 && <span>Already on the list: {r.already.join(", ")}. </span>}
          {r.unknown.length > 0 && <span className="loss">Not found on NSE today: {r.unknown.join(", ")}. </span>}
          {r.truncated && <span>Only the first 100 were checked.</span>}
        </p>
      )}
      {bulk.error && <p className="loss" role="alert" style={{ margin: 0 }}>{bulk.error instanceof ApiError ? bulk.error.message : "Could not add."}</p>}
    </form>
  );
}
