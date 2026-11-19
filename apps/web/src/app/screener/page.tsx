"use client";

import type { Comparator, Condition, NumericField, ScreenRule } from "@kairo/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { PageTitle } from "@/components/PageTitle";
import { ScreenTable } from "@/components/ScreenTable";
import { ErrorCard, Loading } from "@/components/States";
import { api, ApiError, type PresetResult } from "@/lib/api";
import { FIELD_UNITS, FLAG_OPTIONS, NUMERIC_OPTIONS, formatField } from "@/lib/fields";
import { longDate } from "@/lib/format";

/** Builder rows keep user-entered display units (%, ₹ Cr); they become raw units on run. */
type Row =
  | { kind: "value"; field: NumericField; op: Comparator; value: string }
  | { kind: "field"; field: NumericField; op: Comparator; other: NumericField }
  | { kind: "flag"; flag: Extract<Condition, { flag: unknown }>["flag"] };

const OPS: Comparator[] = [">", ">=", "<", "<="];

function toRows(rule: ScreenRule): Row[] {
  return rule.conditions.map((c): Row => {
    if ("flag" in c) return { kind: "flag", flag: c.flag };
    if ("other" in c) return { kind: "field", field: c.field, op: c.op, other: c.other };
    return { kind: "value", field: c.field, op: c.op, value: String(+(c.value / FIELD_UNITS[c.field].scale).toFixed(4)) };
  });
}

function toConditions(rows: Row[]): Condition[] {
  return rows.flatMap((r): Condition[] => {
    if (r.kind === "flag") return [{ flag: r.flag }];
    if (r.kind === "field") return [{ field: r.field, op: r.op, other: r.other }];
    const n = Number(r.value);
    return r.value.trim() === "" || !Number.isFinite(n) ? [] : [{ field: r.field, op: r.op, value: n * FIELD_UNITS[r.field].scale }];
  });
}

export default function Screener() {
  const today = useQuery({ queryKey: ["today"], queryFn: api.today, staleTime: 5 * 60_000 });
  const builderRef = useRef<HTMLDivElement>(null);
  const [universe, setUniverse] = useState<ScreenRule["universe"]>("NIFTY 500");
  const [rows, setRows] = useState<Row[]>([{ kind: "value", field: "rsi14", op: "<", value: "30" }]);
  const [sort, setSort] = useState<ScreenRule["sort"]>({ field: "rsi14", dir: "asc" });

  const rule = (): ScreenRule => ({ universe, conditions: toConditions(rows), sort, limit: 100 });
  const run = useMutation({ mutationFn: api.runScreen });

  const load = (p: PresetResult) => {
    setUniverse(p.rule.universe);
    setRows(toRows(p.rule));
    setSort(p.rule.sort);
    run.mutate({ ...p.rule, limit: 100 });
    builderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (today.isPending) return <Loading rows={5} />;
  if (today.error) return <ErrorCard error={today.error} onRetry={() => void today.refetch()} />;

  return (
    <div className="stack">
      <PageTitle title="Screener" meta={today.data.asOf ? `NSE close · ${longDate(today.data.asOf)}` : "No data yet"} />

      <section aria-labelledby="sotd">
        <h2 id="sotd">Stocks of the day</h2>
        <p className="muted" style={{ marginTop: -6 }}>Rule-based lists, not predictions. Each card says exactly why a stock is on it.</p>
        <div className="cols-3">
          {today.data.presets.map((p) => (
            <PresetCard key={p.id} p={p} onOpen={() => load(p)} />
          ))}
        </div>
      </section>

      <section className="card stack" ref={builderRef} aria-labelledby="builder">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <h2 id="builder" style={{ margin: 0 }}>Build a screen</h2>
          <span className="muted">All conditions must match</span>
        </div>

        <div className="row">
          <label className="muted" htmlFor="universe">Universe</label>
          <select id="universe" className="select" value={universe} onChange={(e) => setUniverse(e.target.value as ScreenRule["universe"])}>
            <option value="NIFTY 500">Nifty 500</option>
            <option value="NIFTY 50">Nifty 50</option>
          </select>
        </div>

        <ul className="conds">
          {rows.map((r, i) => (
            <li key={i} className="row">
              <ConditionEditor row={r} onChange={(n) => setRows(rows.map((x, j) => (j === i ? n : x)))} />
              <button className="btn-quiet" aria-label="Remove condition" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>
            </li>
          ))}
        </ul>

        <div className="row">
          <button className="btn" onClick={() => setRows([...rows, { kind: "value", field: "ret21d", op: ">", value: "5" }])}>+ Number</button>
          <button className="btn" onClick={() => setRows([...rows, { kind: "field", field: "close", op: ">", other: "sma200" }])}>+ Compare</button>
          <button className="btn" onClick={() => setRows([...rows, { kind: "flag", flag: "newHigh52" }])}>+ Event</button>
          <span style={{ flex: 1 }} />
          <label className="muted" htmlFor="sort">Sort</label>
          <select id="sort" className="select" value={sort.field} onChange={(e) => setSort({ ...sort, field: e.target.value as NumericField })}>
            {NUMERIC_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <select className="select" aria-label="Sort direction" value={sort.dir} onChange={(e) => setSort({ ...sort, dir: e.target.value as "asc" | "desc" })}>
            <option value="desc">High → low</option>
            <option value="asc">Low → high</option>
          </select>
          <button className="btn btn-primary" onClick={() => run.mutate(rule())} disabled={run.isPending}>Run</button>
        </div>

        {run.error && <p className="loss" role="alert">{run.error instanceof ApiError ? run.error.message : "Could not run the screen."}</p>}
        {run.data && (
          <>
            <p className="muted" style={{ margin: 0 }} aria-live="polite">{run.data.rows.length} matches</p>
            <ScreenTable rows={run.data.rows} caption="Screen results" />
          </>
        )}
        <SaveScreen rule={rule} />
      </section>

      <SavedScreens />
    </div>
  );
}

function PresetCard({ p, onOpen }: { p: PresetResult; onOpen: () => void }) {
  return (
    <article className="card">
      <div className="page-head" style={{ marginBottom: 4 }}>
        <h3 className="h3">{p.name}</h3>
        <span className="badge">{p.total}</span>
      </div>
      <p className="sub" style={{ margin: "0 0 10px" }}>{p.description}</p>
      {p.rows.length === 0 ? (
        <p className="empty" style={{ padding: "12px 0" }}>None today.</p>
      ) : (
        <table>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.symbol} title={`${r.name} · ${r.industry}`}>
                <td><span className="sym">{r.symbol}</span></td>
                <td className="sub">{NUMERIC_OPTIONS.find(([k]) => k === p.rule.sort.field)?.[1]}</td>
                <td>{formatField(r, p.rule.sort.field)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button className="btn-quiet" style={{ marginTop: 8, paddingLeft: 0 }} onClick={onOpen}>Open in builder →</button>
    </article>
  );
}

function ConditionEditor({ row, onChange }: { row: Row; onChange: (r: Row) => void }) {
  if (row.kind === "flag") {
    return (
      <select className="select grow" aria-label="Event" value={row.flag} onChange={(e) => onChange({ ...row, flag: e.target.value as typeof row.flag })}>
        {FLAG_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
    );
  }
  const unit = FIELD_UNITS[row.field].unit;
  return (
    <>
      <select className="select grow" aria-label="Field" value={row.field} onChange={(e) => onChange({ ...row, field: e.target.value as NumericField })}>
        {NUMERIC_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      <select className="select" aria-label="Operator" value={row.op} onChange={(e) => onChange({ ...row, op: e.target.value as Comparator })}>
        {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {row.kind === "value" ? (
        <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
          <input className="input num" aria-label="Value" inputMode="decimal" value={row.value} onChange={(e) => onChange({ ...row, value: e.target.value })} />
          {unit && <span className="muted">{unit}</span>}
        </span>
      ) : (
        <select className="select grow" aria-label="Compared field" value={row.other} onChange={(e) => onChange({ ...row, other: e.target.value as NumericField })}>
          {NUMERIC_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      )}
    </>
  );
}

function SaveScreen({ rule }: { rule: () => ScreenRule }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [alert, setAlert] = useState(true);
  const save = useMutation({
    mutationFn: api.saveScreen,
    onSuccess: () => {
      setName("");
      void qc.invalidateQueries({ queryKey: ["screens"] });
    },
  });
  return (
    <form
      className="row"
      style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) save.mutate({ name: name.trim(), rule: { ...rule(), limit: 50 }, alert });
      }}
    >
      <input className="input grow" style={{ textTransform: "none" }} placeholder="Name this screen" aria-label="Screen name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      <label className="row" style={{ gap: 6 }}>
        <input type="checkbox" checked={alert} onChange={(e) => setAlert(e.target.checked)} />
        <span>Alert on new matches</span>
      </label>
      <button className="btn" disabled={save.isPending || !name.trim()}>Save</button>
      {save.error && <span className="loss" role="alert">{save.error instanceof ApiError ? save.error.message : "Could not save."}</span>}
    </form>
  );
}

function SavedScreens() {
  const qc = useQueryClient();
  const screens = useQuery({ queryKey: ["screens"], queryFn: api.screens });
  const remove = useMutation({ mutationFn: api.deleteScreen, onSuccess: () => qc.invalidateQueries({ queryKey: ["screens"] }) });
  const [open, setOpen] = useState<number | null>(null);
  const results = useQuery({
    queryKey: ["screen-run", open],
    queryFn: () => api.runScreen(screens.data!.screens.find((s) => s.id === open)!.rule),
    enabled: open !== null && !!screens.data,
  });
  if (!screens.data || screens.data.screens.length === 0) return null;
  return (
    <section className="card">
      <h2>Saved screens</h2>
      <ul className="saved">
        {screens.data.screens.map((s) => (
          <li key={s.id}>
            <div className="row">
              <button className="btn-quiet sym" style={{ paddingLeft: 0 }} aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>{s.name}</button>
              {s.alert && <span className="badge">Alerts</span>}
              <span className="sub">{s.rule.conditions.length} conditions · {s.rule.universe}</span>
              <span style={{ flex: 1 }} />
              <button className="btn-quiet" onClick={() => remove.mutate(s.id)}>Delete</button>
            </div>
            {open === s.id && (results.data ? <ScreenTable rows={results.data.rows} caption={s.name} /> : <Loading rows={2} />)}
          </li>
        ))}
      </ul>
    </section>
  );
}
