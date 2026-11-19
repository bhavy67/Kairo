"use client";

import type { GlobalQuote } from "@kairo/core";
import { useQuery } from "@tanstack/react-query";
import { Change } from "@/components/Change";
import { Sparkline } from "@/components/Sparkline";
import { ErrorCard, Loading } from "@/components/States";
import { api } from "@/lib/api";
import { level, longDate, percent } from "@/lib/format";

const GROUPS: GlobalQuote["group"][] = ["United States", "Asia", "Rates & commodities", "Rupee"];

function value(q: GlobalQuote): string {
  if (q.kind === "yield") return `${q.value.toFixed(2)}%`;
  if (q.unit === "$") return `$${q.value.toFixed(2)}`;
  if (q.unit === "₹") return `₹${q.value.toFixed(2)}`;
  return level(q.value);
}

/**
 * Only equity indices get gain/loss colour. A rising yield, oil price or dollar
 * is not simply good or bad for an Indian investor, so those stay neutral.
 */
function ChangeCell({ q }: { q: GlobalQuote }) {
  if (q.change === null) return <span className="muted">–</span>;
  if (q.kind === "index") return <Change value={q.change} format={(v) => percent(v)} />;
  if (q.kind === "yield") {
    const bps = Math.round(q.change * 100);
    return <span className="muted">{bps > 0 ? "+" : ""}{bps} bps</span>;
  }
  return <span className="muted">{q.change > 0 ? "+" : ""}{percent(q.change)}</span>;
}

export default function Global() {
  const q = useQuery({ queryKey: ["global"], queryFn: api.global, staleTime: 5 * 60_000 });
  if (q.isPending) return <Loading rows={5} />;
  if (q.error) return <ErrorCard error={q.error} onRetry={() => void q.refetch()} />;
  const { quotes, cues, unavailable, sources } = q.data;

  if (quotes.length === 0) {
    return (
      <section className="card">
        <p style={{ margin: 0 }}>No global data yet. It is imported each morning before the Indian open and again after the close.</p>
      </section>
    );
  }

  const us = quotes.find((x) => x.id === "sp500");
  return (
    <div className="stack">
      <h2 className="sr">Global</h2>
      {cues && (
        <section className="card cues" aria-label="Overnight cues">
          <span className="label">Overnight cues{us ? ` · US close ${longDate(us.date)}` : ""}</span>
          <p>{cues}</p>
        </section>
      )}

      {GROUPS.map((g) => {
        const items = quotes.filter((x) => x.group === g);
        if (items.length === 0) return null;
        return (
          <section key={g} aria-labelledby={`g-${g}`}>
            <h2 id={`g-${g}`}>{g}</h2>
            <div className="tiles idx-tiles">
              {items.map((x) => (
                <div key={x.id} className="card">
                  <div className="tile-label">{x.label}</div>
                  <div className="tile-value">{value(x)}</div>
                  <div className="tile-delta"><ChangeCell q={x} /></div>
                  <div style={{ marginTop: 10 }}><Sparkline values={x.history.map((h) => h.value)} /></div>
                  <div className="sub" style={{ marginTop: 6 }}>{longDate(x.date)}</div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <p className="sub" style={{ margin: 0 }}>
        {sources} Not available from free sources: {unavailable.join(", ")}.
      </p>
    </div>
  );
}
