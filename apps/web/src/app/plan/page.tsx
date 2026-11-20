"use client";

import {
  computePlan,
  DEFAULT_ASSUMPTIONS,
  RISK_QUESTIONS,
  type AssetMix,
  type PlanGoal,
  type PlanInput,
  type PlanResult,
  type Priority,
} from "@kairo/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Allocation } from "@/components/Allocation";
import { PageTitle } from "@/components/PageTitle";
import { ErrorCard, Loading } from "@/components/States";
import { api, ApiError } from "@/lib/api";
import { money, share } from "@/lib/format";
import { useReadOnly } from "@/lib/useMe";

const BLANK: PlanInput = {
  version: 1,
  income: 0,
  essentials: 0,
  lifestyle: 0,
  emis: 0,
  emergency: { months: 6, saved: 0 },
  insurance: { term: false, health: false },
  goals: [],
  risk: [],
  assumptions: DEFAULT_ASSUMPTIONS,
};

const PRIORITY: Record<Priority, string> = { must: "Must", should: "Should", nice: "Nice to have" };
const STATUS = { funded: "Covered", partial: "Partly covered", unfunded: "Not covered" } as const;
const CLASSES: { key: keyof AssetMix; label: string; color: string; text?: string }[] = [
  { key: "equity", label: "Equity", color: "var(--tone-1)" },
  { key: "debt", label: "Debt", color: "var(--tone-2)" },
  { key: "gold", label: "Gold", color: "var(--tone-3)", text: "var(--ink)" },
];

const parts = (m: AssetMix) => CLASSES.map((c) => ({ label: c.label, value: m[c.key], color: c.color, ...(c.text ? { text: c.text } : {}) }));
const mixText = (m: AssetMix) => CLASSES.filter((c) => m[c.key] > 0.001).map((c) => `${share(m[c.key])} ${c.label.toLowerCase()}`).join(" · ");
const newId = () => Math.random().toString(36).slice(2, 10);

export default function Plan() {
  const readOnly = useReadOnly();
  const q = useQuery({ queryKey: ["plan"], queryFn: api.plan, staleTime: Infinity });
  const [draft, setDraft] = useState<PlanInput | null>(null);
  const [base, setBase] = useState<{ json: string; updatedAt: string | null } | null>(null);

  // Seed the editor once from the server; later refetches must not clobber edits.
  useEffect(() => {
    if (q.data && !draft) {
      const p = q.data.plan ?? BLANK;
      setDraft(p);
      setBase({ json: JSON.stringify(p), updatedAt: q.data.updatedAt });
    }
  }, [q.data, draft]);

  const result = useMemo(() => (draft ? computePlan(draft, new Date(), q.data?.actual ?? null) : null), [draft, q.data?.actual]);
  const dirty = !!draft && !!base && JSON.stringify(draft) !== base.json;
  const sample = q.data?.sample ?? false;

  const save = useMutation({
    mutationFn: () => api.savePlan(draft!, base!.updatedAt),
    onSuccess: ({ updatedAt }) => setBase({ json: JSON.stringify(draft), updatedAt }),
  });

  useEffect(() => {
    if (!dirty || sample) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, sample]);

  if (q.isPending || (q.data && !draft)) return (<><PageTitle title="Plan" /><Loading rows={6} /></>);
  if (q.error) return (<><PageTitle title="Plan" /><ErrorCard error={q.error} onRetry={() => void q.refetch()} /></>);
  if (!draft || !result) return null;

  const set = (patch: Partial<PlanInput>) => setDraft({ ...draft, ...patch });
  const conflict = save.error instanceof ApiError && save.error.status === 409;

  const status = sample || readOnly
    ? "Sample plan · edits stay in this browser"
    : save.isPending ? "Saving…" : dirty ? "Unsaved changes" : base?.updatedAt ? "Saved" : "Not saved yet";

  return (
    <>
      <PageTitle title="Plan" meta="Your numbers, visible assumptions, no product picks." />
      <div className="page-head plan-head">
        <span className="muted" role="status">{status}</span>
        {!sample && !readOnly && (
          <button className="btn btn-primary" type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            Save plan
          </button>
        )}
      </div>
      {save.error && (
        <div className="card error" role="alert" style={{ marginBottom: 16 }}>
          <p style={{ margin: "0 0 12px" }}>{save.error.message}</p>
          {conflict && <button className="btn" type="button" onClick={() => window.location.reload()}>Reload</button>}
        </div>
      )}

      <div className="plan-grid">
        <div className="plan-results stack">
          <Results r={result} input={draft} />
        </div>
        <form className="plan-inputs stack" onSubmit={(e) => e.preventDefault()} aria-label="Plan inputs">
          <CashFlow input={draft} set={set} />
          <Safety input={draft} set={set} />
          <Goals goals={draft.goals} onChange={(goals) => set({ goals })} />
          <Risk answers={draft.risk} onChange={(risk) => set({ risk })} />
          <Assumptions a={draft.assumptions} onChange={(assumptions) => set({ assumptions })} />
        </form>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- results */

function Results({ r, input }: { r: PlanResult; input: PlanInput }) {
  if (input.income <= 0) {
    return (
      <section className="card">
        <h2>Start with this month</h2>
        <p className="muted" style={{ margin: 0 }}>
          Enter take-home income and spending. Kairo then works out the emergency fund, what each goal needs per month, and how the money should be split.
        </p>
      </section>
    );
  }
  return (
    <>
      <section className="card hero" aria-label="Monthly plan">
        <span className="hero-label">Available to invest each month</span>
        <span className="hero-value">{money(Math.max(0, r.monthly.surplus))}</span>
        <span className="muted">
          {r.monthly.savingsRate === null ? "" : `${share(Math.max(0, r.monthly.savingsRate))} of take-home`} · {money(r.monthly.outflow)} spent
        </span>
        <dl className="hero-facts">
          <div><dt className="label">Emergency</dt><dd>{money(r.emergency.monthly)}</dd></div>
          <div><dt className="label">Goals</dt><dd>{money(r.totals.funded)}</dd></div>
          <div><dt className="label">{r.totals.shortfall > 0.5 ? "Short by" : "Spare"}</dt><dd className={r.totals.shortfall > 0.5 ? "loss" : ""}>{money(r.totals.shortfall > 0.5 ? r.totals.shortfall : Math.max(0, r.investable - r.totals.funded))}</dd></div>
          <div><dt className="label">Risk profile</dt><dd style={{ textTransform: "capitalize" }}>{r.risk.profile}</dd></div>
        </dl>
      </section>

      <section className="card">
        <h2>Next steps</h2>
        {r.notes.length ? (
          <ol className="notes">{r.notes.map((n) => <li key={n}>{n}</li>)}</ol>
        ) : (
          <p className="muted" style={{ margin: 0 }}>Nothing urgent. Every goal is covered at the base-case returns.</p>
        )}
      </section>

      {r.goals.length > 0 && (
        <section className="card">
          <h2>Goals</h2>
          <ul className="goal-list">
            {r.goals.map((g) => (
              <li key={g.id}>
                <div className="goal-main">
                  <span className="h3">{g.name}</span>
                  <span className="sub">
                    {PRIORITY[g.priority]} · {g.years === 0 ? "this year" : `in ${g.years} ${g.years === 1 ? "year" : "years"}`} · {money(g.futureCost)} then
                  </span>
                  <span className="sub">{mixText(g.mix)}</span>
                </div>
                <div className="goal-sip">
                  {g.dueNow ? (
                    <span className="sub">Lump sum</span>
                  ) : (
                    <>
                      <span className="v">{money(g.sip.base)}<span className="sub">/mo</span></span>
                      <span className="sub" title="Cautious to optimistic returns">{money(g.sip.optimistic)} – {money(g.sip.cautious)}</span>
                    </>
                  )}
                  <span className={`pill ${g.status}`}>{g.dueNow ? "Due now" : STATUS[g.status]}</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="sub" style={{ margin: "14px 0 0" }}>
            The range shows the SIP needed if returns come in {pp(-2)} or {pp(+2)} on equity. Plan on the base figure, check yearly.
          </p>
        </section>
      )}

      <section className="card">
        <h2>Allocation</h2>
        <h3 className="label" style={{ margin: "0 0 4px" }}>Target</h3>
        <Allocation parts={parts(r.target)} format={share} />
        {r.actual ? (
          <>
            <h3 className="label" style={{ margin: "18px 0 4px" }}>Today · {money(r.actual.total)}</h3>
            <Allocation parts={parts(r.actual.value)} />
          </>
        ) : (
          <p className="sub">Connect Kite to compare with what you hold today.</p>
        )}
        {r.totals.funded + r.emergency.monthly > 0 && (
          <>
            <h3 className="label" style={{ margin: "18px 0 4px" }}>Each month’s money</h3>
            <Allocation parts={parts(r.monthlySplit)} />
          </>
        )}
        <p className="sub" style={{ margin: "6px 0 0" }}>Equity, debt and gold here are asset classes, not specific funds. Hybrid funds are split by their typical mandate.</p>
      </section>
    </>
  );
}

const pp = (d: number) => `${d > 0 ? "+" : "−"}${Math.abs(d)} pp`;

/* ---------------------------------------------------------------- inputs */

/** Rupee input: free typing while focused, grouped digits (₹1,20,000) otherwise. */
function MoneyField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value ? value.toLocaleString("en-IN") : "");
  return (
    <label className="field">
      <span className="label">{label}</span>
      <span className="affix">
        <span aria-hidden>₹</span>
        <input
          className="input plain num-in"
          inputMode="numeric"
          value={shown}
          placeholder="0"
          onFocus={() => setText(value ? String(value) : "")}
          onBlur={() => setText(null)}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d]/g, "");
            setText(raw);
            onChange(raw ? Math.min(1e12, Number(raw)) : 0);
          }}
        />
      </span>
      {hint && <span className="sub">{hint}</span>}
    </label>
  );
}

/** Annual rate shown as a percentage. */
function PctField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <span className="affix after">
        <input
          className="input plain num-in"
          type="number"
          step={0.5}
          min={-20}
          max={50}
          value={+(value * 100).toFixed(2)}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(Math.max(-0.2, Math.min(0.5, v / 100)));
          }}
        />
        <span aria-hidden>%</span>
      </span>
    </label>
  );
}

function Fieldset({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <fieldset className="card plan-set">
      <legend><h2>{title}</h2></legend>
      {children}
      {note && <p className="sub" style={{ margin: "12px 0 0" }}>{note}</p>}
    </fieldset>
  );
}

function CashFlow({ input, set }: { input: PlanInput; set: (p: Partial<PlanInput>) => void }) {
  return (
    <Fieldset title="Each month">
      <div className="fields">
        <MoneyField label="Take-home income" value={input.income} onChange={(income) => set({ income })} />
        <MoneyField label="Essentials" value={input.essentials} onChange={(essentials) => set({ essentials })} hint="Rent, food, bills, premiums" />
        <MoneyField label="Lifestyle" value={input.lifestyle} onChange={(lifestyle) => set({ lifestyle })} hint="Eating out, travel, shopping" />
        <MoneyField label="Loan EMIs" value={input.emis} onChange={(emis) => set({ emis })} />
      </div>
    </Fieldset>
  );
}

function Safety({ input, set }: { input: PlanInput; set: (p: Partial<PlanInput>) => void }) {
  return (
    <Fieldset title="Safety net" note="Emergency fund = months × (essentials + EMIs). Kept in debt: liquid funds or a sweep FD.">
      <div className="fields">
        <label className="field">
          <span className="label">Emergency fund</span>
          <select className="select" value={input.emergency.months} onChange={(e) => set({ emergency: { ...input.emergency, months: Number(e.target.value) } })}>
            {[3, 6, 9, 12].map((m) => <option key={m} value={m}>{m} months</option>)}
          </select>
        </label>
        <MoneyField label="Saved so far" value={input.emergency.saved} onChange={(saved) => set({ emergency: { ...input.emergency, saved } })} />
      </div>
      <div className="row" style={{ marginTop: 14, gap: 20 }}>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={input.insurance.health} onChange={(e) => set({ insurance: { ...input.insurance, health: e.target.checked } })} />
          Health insurance
        </label>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={input.insurance.term} onChange={(e) => set({ insurance: { ...input.insurance, term: e.target.checked } })} />
          Term life cover
        </label>
      </div>
    </Fieldset>
  );
}

function Goals({ goals, onChange }: { goals: PlanGoal[]; onChange: (g: PlanGoal[]) => void }) {
  const year = new Date().getFullYear();
  const update = (i: number, patch: Partial<PlanGoal>) => onChange(goals.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  return (
    <Fieldset title="Goals" note="Cost in today’s rupees; inflation is applied for you. Education usually runs near 10% a year.">
      <div className="stack" style={{ gap: 12 }}>
        {goals.map((g, i) => (
          <div key={g.id} className="goal-edit">
            <div className="row">
              <input className="input plain grow" aria-label="Goal name" value={g.name} maxLength={60} onChange={(e) => update(i, { name: e.target.value })} />
              <button type="button" className="btn-quiet" aria-label={`Remove ${g.name}`} onClick={() => onChange(goals.filter((_, j) => j !== i))}>Remove</button>
            </div>
            <div className="fields">
              <MoneyField label="Cost today" value={g.costToday} onChange={(costToday) => update(i, { costToday })} />
              <label className="field">
                <span className="label">Year</span>
                <input className="input plain num-in" type="number" min={year} max={year + 60} value={g.targetYear} onChange={(e) => update(i, { targetYear: Math.round(Number(e.target.value)) || year })} />
              </label>
              <label className="field">
                <span className="label">Priority</span>
                <select className="select" value={g.priority} onChange={(e) => update(i, { priority: e.target.value as Priority })}>
                  {(Object.keys(PRIORITY) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY[p]}</option>)}
                </select>
              </label>
              <MoneyField label="Saved for it" value={g.saved} onChange={(saved) => update(i, { saved })} />
              <PctField label="Inflation" value={g.inflation ?? DEFAULT_ASSUMPTIONS.inflation} onChange={(inflation) => update(i, { inflation })} />
            </div>
          </div>
        ))}
        {goals.length < 20 && (
          <button
            type="button"
            className="btn"
            style={{ justifySelf: "start" }}
            onClick={() => onChange([...goals, { id: newId(), name: "New goal", costToday: 0, targetYear: year + 5, priority: "should", saved: 0 }])}
          >
            Add goal
          </button>
        )}
      </div>
    </Fieldset>
  );
}

function Risk({ answers, onChange }: { answers: number[]; onChange: (a: number[]) => void }) {
  const set = (i: number, v: number) => {
    // 0 = not answered yet; the profile applies once all five are answered.
    onChange(RISK_QUESTIONS.map((_, j) => (j === i ? v : answers[j] ?? 0)));
  };
  return (
    <Fieldset title="Risk" note="Sets the most equity any goal may hold: 40% conservative, 60% balanced, 80% aggressive. Short goals hold less regardless.">
      <div className="stack" style={{ gap: 16 }}>
        {RISK_QUESTIONS.map((rq, i) => (
          <div key={rq.q} role="radiogroup" aria-label={rq.q} className="risk-q">
            <span className="h3">{rq.q}</span>
            {rq.options.map((o, k) => (
              <label key={o} className="row" style={{ gap: 8 }}>
                <input type="radio" name={`risk-${i}`} checked={answers[i] === k + 1} onChange={() => set(i, k + 1)} />
                <span className="muted" style={{ color: "var(--ink-2)" }}>{o}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </Fieldset>
  );
}

function Assumptions({ a, onChange }: { a: PlanInput["assumptions"]; onChange: (a: PlanInput["assumptions"]) => void }) {
  // Compare values, not JSON: the database returns keys in its own order.
  const changed = (Object.keys(DEFAULT_ASSUMPTIONS) as (keyof typeof a)[]).some((k) => Math.abs(a[k] - DEFAULT_ASSUMPTIONS[k]) > 1e-9);
  return (
    <Fieldset
      title="Assumptions"
      note={
        <>
          Long-run annual returns before tax, not forecasts. Lower them if you want a margin of safety.{" "}
          {changed && <button type="button" className="btn-quiet" onClick={() => onChange(DEFAULT_ASSUMPTIONS)}>Reset</button>}
        </>
      }
    >
      <div className="fields">
        <PctField label="Inflation" value={a.inflation} onChange={(inflation) => onChange({ ...a, inflation })} />
        <PctField label="Equity" value={a.equity} onChange={(equity) => onChange({ ...a, equity })} />
        <PctField label="Debt" value={a.debt} onChange={(debt) => onChange({ ...a, debt })} />
        <PctField label="Gold" value={a.gold} onChange={(gold) => onChange({ ...a, gold })} />
      </div>
    </Fieldset>
  );
}
