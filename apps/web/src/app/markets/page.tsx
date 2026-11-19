"use client";

import type { Breadth, IndexQuote, Mover, SectorMove } from "@kairo/core";
import { useQuery } from "@tanstack/react-query";
import { Change } from "@/components/Change";
import { Sparkline } from "@/components/Sparkline";
import { ErrorCard, Loading } from "@/components/States";
import { api } from "@/lib/api";
import { big, level, longDate, money2, percent, ratio, share } from "@/lib/format";

export default function Markets() {
  const q = useQuery({ queryKey: ["market"], queryFn: api.market, staleTime: 5 * 60_000 });
  if (q.isPending) return <Loading rows={5} />;
  if (q.error) return <ErrorCard error={q.error} onRetry={() => void q.refetch()} />;
  const m = q.data;

  if (!m.asOf) {
    return (
      <div className="stack">
        <div className="page-head"><h1>Markets</h1></div>
        <section className="card">
          <p style={{ marginTop: 0 }}>No market data yet. The API imports NSE end-of-day files every evening after 18:30 IST.</p>
          <p className="muted" style={{ marginBottom: 0 }}>To load history now: <code>pnpm --filter @kairo/api backfill</code></p>
        </section>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Markets</h1>
        <span className="muted">NSE close · {longDate(m.asOf)}</span>
      </div>

      <section className="tiles idx-tiles" aria-label="Indices">
        {m.indices.map((i) => <IndexTile key={i.name} q={i} />)}
      </section>

      {m.breadth && <BreadthCard b={m.breadth} />}

      <section className="card">
        <div className="page-head" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Sectors</h2>
          <span className="muted">Nifty 500, equal-weighted day change</span>
        </div>
        <Heatmap sectors={m.sectors} />
      </section>

      <div className="cols-3">
        <MoverList title="Top gainers" rows={m.gainers} />
        <MoverList title="Top losers" rows={m.losers} />
        <MoverList title="Volume spikes" note="vs 20-day average" rows={m.volumeSpikes} showRatio />
      </div>

      <DataStatus />
    </div>
  );
}

function IndexTile({ q }: { q: IndexQuote }) {
  // Volatility rising is not "good" or "bad" in the gain/loss sense: keep it neutral.
  const neutral = q.name === "India VIX";
  return (
    <div className="card">
      <div className="tile-label">{q.name}</div>
      <div className="tile-value">{level(q.close)}</div>
      <div className="tile-delta">
        {q.changePct === null ? "–" : neutral ? <span className="muted">{percent(q.changePct)}</span> : <Change value={q.changePct} format={(v) => percent(v)} />}
      </div>
      <div style={{ marginTop: 10 }}><Sparkline values={q.history.map((h) => h.close)} /></div>
      {q.pe !== null && <div className="sub" style={{ marginTop: 6 }}>P/E {q.pe.toFixed(1)}</div>}
    </div>
  );
}

function BreadthCard({ b }: { b: Breadth }) {
  const total = b.advances + b.declines + b.unchanged;
  const parts = [
    { label: "Advances", n: b.advances, color: "var(--gain-fill)" },
    { label: "Unchanged", n: b.unchanged, color: "var(--line-strong)" },
    { label: "Declines", n: b.declines, color: "var(--loss-fill)" },
  ].filter((p) => p.n > 0);
  return (
    <section className="card">
      <div className="page-head" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Breadth</h2>
        <span className="muted">{b.universe}</span>
      </div>
      <div className="seg" role="img" aria-label={`${b.advances} advances, ${b.unchanged} unchanged, ${b.declines} declines`}>
        {parts.map((p) => (
          <div key={p.label} style={{ flexGrow: p.n, flexBasis: 0, background: p.color }} title={`${p.label}: ${p.n}`}>
            {p.n / total >= 0.08 ? p.n : ""}
          </div>
        ))}
      </div>
      <div className="legend" style={{ marginBottom: 16 }}>
        {parts.map((p) => (
          <span key={p.label}><i style={{ background: p.color }} />{p.label} · {p.n}</span>
        ))}
        <span>A/D ratio · {b.declines ? (b.advances / b.declines).toFixed(2) : "–"}</span>
      </div>
      <div className="tiles">
        <Stat label="Above 50-day average" value={b.above50 === null ? "–" : share(b.above50)} />
        <Stat label="Above 200-day average" value={b.above200 === null ? "–" : share(b.above200)} />
        <Stat label="New 52-week highs" value={String(b.newHighs)} />
        <Stat label="New 52-week lows" value={String(b.newLows)} />
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
    </div>
  );
}

/** Diverging fill, clamped at ±3%. Text stays in ink colours; the fill only tints. */
function tint(pct: number): string {
  const strength = Math.min(Math.abs(pct) / 0.03, 1) * 38;
  if (Math.abs(pct) < 0.0005) return "var(--surface)";
  return `color-mix(in srgb, ${pct > 0 ? "var(--gain-fill)" : "var(--loss-fill)"} ${strength.toFixed(0)}%, var(--surface))`;
}

function Heatmap({ sectors }: { sectors: SectorMove[] }) {
  return (
    <ul className="heatmap">
      {sectors.map((s) => (
        <li key={s.industry} style={{ background: tint(s.avgChangePct) }} title={`${s.industry}: ${s.advances} up, ${s.declines} down of ${s.stocks}`}>
          <span className="heat-name">{s.industry}</span>
          <span className="heat-value"><Change value={s.avgChangePct} format={(v) => percent(v)} /></span>
          <span className="sub">{s.advances}↑ {s.declines}↓ · {s.stocks}</span>
        </li>
      ))}
    </ul>
  );
}

function MoverList({ title, note, rows, showRatio }: { title: string; note?: string; rows: Mover[]; showRatio?: boolean }) {
  return (
    <section className="card">
      <h2>{title} {note && <span className="muted" style={{ fontWeight: 400 }}>· {note}</span>}</h2>
      {rows.length === 0 ? (
        <p className="empty">None today.</p>
      ) : (
        <table>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} title={`${r.name} · ${r.industry} · vol ${big(r.volume)}`}>
                <td><div className="sym">{r.symbol}</div><div className="sub">{money2(r.close)}</div></td>
                <td>{showRatio ? <span>{ratio(r.volumeRatio)}</span> : null}</td>
                <td><Change value={r.changePct} format={(v) => percent(v)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function DataStatus() {
  const q = useQuery({ queryKey: ["ingest"], queryFn: api.ingestRuns, staleTime: 5 * 60_000 });
  if (!q.data) return null;
  return (
    <details className="card">
      <summary className="muted" style={{ cursor: "pointer" }}>Data source: NSE end-of-day archive · import log</summary>
      <table style={{ marginTop: 12 }}>
        <thead><tr><th>Date</th><th>Status</th><th>Rows</th><th>Note</th></tr></thead>
        <tbody>
          {q.data.runs.slice(0, 10).map((r) => (
            <tr key={r.date}>
              <td>{r.date}</td>
              <td className={r.status === "failed" ? "loss" : undefined}>{r.status}</td>
              <td>{r.rows}</td>
              <td className="sub">{r.error ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
