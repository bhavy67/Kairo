"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Change } from "@/components/Change";
import { PriceChart } from "@/components/PriceChart";
import { ErrorCard, Loading } from "@/components/States";
import { api, ApiError } from "@/lib/api";
import { useReadOnly } from "@/lib/useMe";
import { longDate, money, money2, percent, qty, ratio } from "@/lib/format";

const KIND: Record<string, string> = {
  price_above: "Closes above",
  price_below: "Closes below",
  move_pct: "Moves at least",
  cross_200dma: "Crosses its 200-day average",
};

/** Plain-language reading of RSI: a description of state, not advice. */
function rsiNote(v: number | null) {
  if (v === null) return "";
  if (v >= 70) return "stretched up";
  if (v <= 30) return "stretched down";
  return "neutral";
}

export default function StockPage() {
  const params = useParams<{ symbol: string }>();
  const sym = decodeURIComponent(params?.symbol ?? "").toUpperCase();
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const q = useQuery({ queryKey: ["stock", sym], queryFn: () => api.stock(sym) });
  const watch = useMutation({
    mutationFn: async (on: boolean) => {
      if (on) await api.addWatch(sym);
      else await api.removeWatch(sym);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stock", sym] });
      void qc.invalidateQueries({ queryKey: ["watchlist"] });
    },
  });

  if (q.isPending) return <Loading rows={6} />;
  if (q.error) return <ErrorCard error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;
  const g = s.signals;
  const pnl = s.position ? s.position.quantity * (s.close - s.position.averagePrice) : null;

  const facts: [string, React.ReactNode][] = g
    ? [
        ["RSI (14)", g.rsi14 === null ? "–" : <>{g.rsi14.toFixed(0)} <span className="sub">{rsiNote(g.rsi14)}</span></>],
        ["vs 50-day avg", g.vsSma50 === null ? "–" : <Change value={g.vsSma50} format={(v) => percent(v)} />],
        ["vs 200-day avg", g.vsSma200 === null ? "–" : <Change value={g.vsSma200} format={(v) => percent(v)} />],
        ["From 52-week high", g.fromHigh52 === null ? "–" : percent(g.fromHigh52)],
        ["1 month", g.ret21d === null ? "–" : <Change value={g.ret21d} format={(v) => percent(v)} />],
        ["3 months", g.ret63d === null ? "–" : <Change value={g.ret63d} format={(v) => percent(v)} />],
        ["Volume vs 20-day", ratio(g.volRatio)],
        ["52-week range", g.lo52 === null || g.hi52 === null ? "–" : `${money(g.lo52)} – ${money(g.hi52)}`],
      ]
    : [];

  return (
    <div className="stack">
      <div className="stock-head">
        <div className="stock-id">
          <h1>{s.symbol}</h1>
          <span className="muted">{s.name}{s.industry ? ` · ${s.industry}` : ""}</span>
        </div>
        {!readOnly && (<button
          className={s.watching ? "btn" : "btn btn-primary"}
          onClick={() => watch.mutate(!s.watching)}
          disabled={watch.isPending}
          aria-pressed={s.watching}
        >
          {s.watching ? "On watchlist ✓" : "Add to watchlist"}
        </button>)}
      </div>
      {watch.error && <p className="loss" role="alert">{watch.error instanceof ApiError ? watch.error.message : "Could not update the watchlist."}</p>}

      <section className="card">
        <div className="stock-price">
          <span className="hero-value"><AnimatedNumber value={s.close} format={money2} /></span>
          {s.changePct !== null && <Change value={s.changePct} format={(v) => percent(v)} />}
          <span className="sub">NSE close · {longDate(s.asOf)}</span>
        </div>
        <div style={{ marginTop: 18 }}>
          <PriceChart series={s.series} />
        </div>
        <p className="sub" style={{ margin: "10px 0 0" }}>Adjusted for bonuses and splits.</p>
      </section>

      {g && (
        <section aria-label="Signals" className="facts">
          {facts.map(([label, value]) => (
            <div key={label}>
              <span className="label">{label}</span>
              <span className="v">{value}</span>
            </div>
          ))}
        </section>
      )}

      <div className="two-col">
        <section className="card">
          <h2>Your position</h2>
          {s.position ? (
            <div className="facts" style={{ border: 0 }}>
              <div><span className="label">Quantity</span><span className="v">{qty(s.position.quantity)}</span></div>
              <div><span className="label">Avg cost</span><span className="v">{money2(s.position.averagePrice)}</span></div>
              <div><span className="label">Value</span><span className="v">{money(s.position.quantity * s.close)}</span></div>
              <div><span className="label">P&amp;L</span><span className="v">{pnl === null ? "–" : <Change value={pnl} format={money} />}</span></div>
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>You don’t hold {s.symbol}.</p>
          )}
          <p style={{ margin: "12px 0 0" }}><Link href="/portfolio/returns" className="muted">Returns from your tradebook →</Link></p>
        </section>
        <section className="card">
          <h2>Alerts</h2>
          {s.alerts.length ? (
            <ul className="notes">
              {s.alerts.map((a) => (
                <li key={a.id}>
                  {KIND[a.kind]} {a.threshold === null ? "" : a.kind === "move_pct" ? `${(a.threshold * 100).toFixed(1)}%` : money2(a.threshold)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: 0 }}>No alerts on {s.symbol}.</p>
          )}
          {!readOnly && <p style={{ margin: "12px 0 0" }}><Link href={`/watch/alerts?symbol=${encodeURIComponent(s.symbol)}`} className="muted">Add an alert →</Link></p>}
        </section>
      </div>
    </div>
  );
}
