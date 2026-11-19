import { signed } from "@/lib/format";

/**
 * A signed value. Direction is carried by the sign and an arrow as well as colour,
 * so it still reads for colour-blind users and in print.
 */
export function Change({ value, format, pct }: { value: number; format: (n: number) => string; pct?: string }) {
  const tone = value > 0 ? "gain" : value < 0 ? "loss" : "flat";
  const arrow = value > 0 ? "▲" : value < 0 ? "▼" : "";
  return (
    <span className={tone}>
      {arrow && <span className="arrow" aria-hidden="true">{arrow} </span>}
      {signed(value, format)}
      {pct && <span> ({pct})</span>}
    </span>
  );
}
