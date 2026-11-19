import { share } from "@/lib/format";

/** Horizontal bars for a ranked share, one hue. Beats a pie once there are more than a few parts. */
export function BarList({ items, max = 8 }: { items: { label: string; value: number; weight: number; detail?: string }[]; max?: number }) {
  const head = items.slice(0, max);
  const rest = items.slice(max);
  const rows = rest.length
    ? [...head, { label: `Other (${rest.length})`, value: rest.reduce((s, r) => s + r.value, 0), weight: rest.reduce((s, r) => s + r.weight, 0) }]
    : head;
  const top = Math.max(...rows.map((r) => r.weight), 0.0001);
  return (
    <ul className="barlist">
      {rows.map((r) => (
        <li key={r.label} title={"detail" in r && r.detail ? r.detail : undefined}>
          <span className="barlist-label">{r.label}</span>
          <span className="barlist-track"><span style={{ width: `${(r.weight / top) * 100}%` }} /></span>
          <span className="barlist-value">{share(r.weight)}</span>
        </li>
      ))}
    </ul>
  );
}
