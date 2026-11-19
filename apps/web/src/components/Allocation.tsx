import { money, share } from "@/lib/format";

interface Part {
  label: string;
  value: number;
  color: string;
  /** Label colour inside the segment; defaults to the page background. */
  text?: string;
}

/** A segmented bar: one whole split into parts. Labels print inside only when they fit. */
export function Allocation({ parts }: { parts: Part[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return <p className="muted">Nothing to allocate yet.</p>;
  const visible = parts.filter((p) => p.value > 0);
  return (
    <figure style={{ margin: 0 }}>
      <div className="seg" role="img" aria-label={visible.map((p) => `${p.label} ${share(p.value / total)}`).join(", ")}>
        {visible.map((p) => {
          const w = p.value / total;
          return (
            <div key={p.label} style={{ flexGrow: w, flexBasis: 0, background: p.color, color: p.text ?? "var(--bg)" }} title={`${p.label}: ${money(p.value)} (${share(w)})`}>
              {w >= 0.08 ? share(w) : ""}
            </div>
          );
        })}
      </div>
      <figcaption className="legend">
        {visible.map((p) => (
          <span key={p.label}>
            <i style={{ background: p.color }} />
            {p.label} · {money(p.value)}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
