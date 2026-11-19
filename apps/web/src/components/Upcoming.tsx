export function Upcoming({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="stack">
      <div className="page-head"><h2 className="sr">{title}</h2><span className="badge">Coming next</span></div>
      <section className="card">
        <p style={{ marginTop: 0 }}>Not built yet. Planned:</p>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ink-2)" }}>
          {items.map((i) => <li key={i}>{i}</li>)}
        </ul>
      </section>
    </div>
  );
}
