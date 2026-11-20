import { signed } from "@/lib/format";
import { Odometer, useDirection } from "./Odometer";

/**
 * A signed value. Direction is carried by the sign and an arrow as well as colour,
 * so it still reads for colour-blind users and in print. With `animate`, refreshed
 * values roll their changed digits (see Odometer).
 */
export function Change({ value, format, pct, animate = false }: { value: number; format: (n: number) => string; pct?: string; animate?: boolean }) {
  const tone = value > 0 ? "gain" : value < 0 ? "loss" : "flat";
  const arrow = value > 0 ? "▲" : value < 0 ? "▼" : "";
  const dir = useDirection(value);
  const text = signed(value, format);
  return (
    <span className={tone}>
      {arrow && <span className="arrow" aria-hidden="true">{arrow} </span>}
      {animate ? <Odometer text={text} dir={dir} /> : text}
      {pct && <span> ({animate ? <Odometer text={pct} dir={dir} /> : pct})</span>}
    </span>
  );
}
