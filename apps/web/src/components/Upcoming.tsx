export function Upcoming({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="stack">
      <div className="page-head"><h1>{title}</h1><span className="badge">Phase 2</span></div>
      <section className="card">
        <p style={{ marginTop: 0 }}>Not built yet. Planned:</p>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ink-2)" }}>
          {items.map((i) => <li key={i}>{i}</li>)}
        </ul>
      </section>
    </div>
  );
}
