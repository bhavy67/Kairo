"use client";

import type { IndexQuote } from "@kairo/core";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Allocation } from "@/components/Allocation";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { BarList } from "@/components/BarList";
import { Change } from "@/components/Change";
import { HoldingsTable } from "@/components/HoldingsTable";
import { PageTitle } from "@/components/PageTitle";
import { Sparkline } from "@/components/Sparkline";
import { ErrorCard, Loading } from "@/components/States";
import { api } from "@/lib/api";
import { buildFeed, marketMood } from "@/lib/feed";
import { level, longDate, money, percent, timeIst } from "@/lib/format";
import { usePortfolio } from "@/lib/usePortfolio";

const PULSE = ["Nifty 50", "Nifty Bank", "India VIX"];

export default function Today() {
  const { data, error, isPending, refetch, isFetching } = usePortfolio();
  const market = useQuery({ queryKey: ["market"], queryFn: api.market, staleTime: 5 * 60_000 });
  const alerts = useQuery({ queryKey: ["alerts"], queryFn: api.alerts, staleTime: 5 * 60_000 });
  const screens = useQuery({ queryKey: ["today"], queryFn: api.today, staleTime: 5 * 60_000 });
  const global = useQuery({ queryKey: ["global"], queryFn: api.global, staleTime: 5 * 60_000 });

  if (isPending) return <Loading rows={5} />;
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />;

  const { summary: s, cash } = data;
  const m = market.data;
  const index = (name: string) => m?.indices.find((i) => i.name === name);
  const mood = m ? marketMood(m.breadth, index("Nifty 50"), index("India VIX")) : null;
  const feed = buildFeed({ asOf: m?.asOf ?? null, holdings: data.holdings, events: alerts.data?.events ?? [], presets: screens.data?.presets ?? [] });

  return (
    <div className="stack">
      <PageTitle
        title="Today"
        meta={
          <span aria-live="polite">
            {isFetching
              ? "Refreshing…"
              : data.source === "snapshot" && data.snapshotAt
                ? `Holdings synced ${longDate(data.snapshotAt.slice(0, 10))} ${timeIst(data.snapshotAt)} IST · valued at NSE close${m?.asOf ? ` ${longDate(m.asOf)}` : ""}`
                : `Prices as of ${timeIst(data.asOf)} IST${m?.asOf ? ` · NSE close ${longDate(m.asOf)}` : ""}`}
          </span>
        }
      />

      <div className="today-grid">
        <section className="card hero" aria-label="Portfolio value">
          <span className="hero-label">Portfolio value</span>
          <span className="hero-value"><AnimatedNumber value={s.total.current} format={money} /></span>
          <div className="hero-sub">
            <span>Today <Change value={s.equity.dayChange} format={money} pct={percent(s.equity.dayChangePct)} /></span>
            <span>Overall <Change value={s.total.pnl} format={money} pct={percent(s.total.pnlPct)} /></span>
          </div>
          <dl className="hero-facts">
            <div><dt className="label">Invested</dt><dd>{money(s.total.invested)}</dd></div>
            <div><dt className="label">Equity</dt><dd>{money(s.equity.current)}</dd></div>
            <div><dt className="label">Funds</dt><dd>{money(s.funds.current)}</dd></div>
            <div><dt className="label">Cash</dt><dd>{money(cash.available)}</dd></div>
          </dl>
        </section>

        <section className="card feed" aria-labelledby="changed">
          <h2 id="changed">What changed</h2>
          {mood && <p className="mood">{mood}</p>}
          {global.data?.cues && (
            <p className="mood">
              <Link href="/markets/global" className="label" style={{ display: "block", marginBottom: 4 }}>Overnight</Link>
              {global.data.cues}
            </p>
          )}
          {feed.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Quiet day: no holding moved more than 2% and no alert fired.</p>
          ) : (
            <ol className="feed-list">
              {feed.map((f, i) => (
                <li key={f.id} style={{ animationDelay: `${i * 40}ms` }}>
                  <span className={`feed-dot ${f.tone}`} aria-hidden />
                  {f.symbol ? <Link href={`/s/${encodeURIComponent(f.symbol)}`}>{f.text}</Link> : <span>{f.text}</span>}
                  <span className="sub">{f.meta}</span>
                </li>
              ))}
            </ol>
          )}
          <Link href="/watch/alerts" className="muted feed-more">Alerts and rules →</Link>
        </section>
      </div>

      {m && m.indices.length > 0 && (
        <section className="pulse" aria-label="Market pulse">
          {PULSE.map((n) => index(n)).filter((q): q is IndexQuote => !!q).map((q) => (
            <Link key={q.name} href="/markets" className="card pulse-item">
              <span className="label">{q.name}</span>
              <span className="pulse-row">
                <strong>{level(q.close)}</strong>
                {q.changePct !== null && (q.name === "India VIX" ? <span className="muted">{percent(q.changePct)}</span> : <Change value={q.changePct} format={(v) => percent(v)} />)}
              </span>
              <Sparkline values={q.history.slice(-30).map((h) => h.close)} height={28} />
            </Link>
          ))}
        </section>
      )}

      <div className="two-col">
        <section className="card">
          <h2>Allocation</h2>
          <Allocation
            parts={[
              { label: "Equity", value: s.equity.current, color: "var(--tone-1)" },
              { label: "Mutual funds", value: s.funds.current, color: "var(--tone-2)" },
              { label: "Cash", value: cash.available, color: "var(--tone-3)", text: "var(--ink)" },
            ]}
          />
        </section>
        {data.sectors.length > 0 && (
          <section className="card">
            <h2>Equity by sector</h2>
            <BarList max={6} items={data.sectors.map((x) => ({ label: x.sector, value: x.value, weight: x.weight, detail: `${money(x.value)} · ${x.holdings} holdings` }))} />
          </section>
        )}
      </div>

      <section className="card">
        <div className="page-head" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Top holdings</h2>
          <Link href="/portfolio" className="muted">All holdings →</Link>
        </div>
        <HoldingsTable rows={data.holdings.slice(0, 5)} />
      </section>
    </div>
  );
}
