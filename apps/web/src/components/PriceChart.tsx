"use client";

import { useMemo, useRef, useState } from "react";
import { longDate, money2, percent } from "@/lib/format";

const RANGES = [
  { label: "1M", n: 21 },
  { label: "3M", n: 63 },
  { label: "6M", n: 126 },
  { label: "1Y", n: 260 },
] as const;

const W = 800;
const H = 260;
const PAD = { t: 12, r: 8, b: 22, l: 8 };

/**
 * A single ink line with a crosshair. Monochrome on purpose: the period change
 * beside the range buttons carries the colour, the chart carries the shape.
 */
export function PriceChart({ series }: { series: { date: string; close: number }[] }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["label"]>("6M");
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  const data = useMemo(() => series.slice(-RANGES.find((r) => r.label === range)!.n), [series, range]);
  const { path, x, y, min, max } = useMemo(() => {
    const closes = data.map((d) => d.close);
    const lo = Math.min(...closes);
    const hi = Math.max(...closes);
    const span = hi - lo || 1;
    const xf = (i: number) => PAD.l + (i / Math.max(1, data.length - 1)) * (W - PAD.l - PAD.r);
    const yf = (v: number) => PAD.t + (1 - (v - lo) / span) * (H - PAD.t - PAD.b);
    const d = data.map((p, i) => `${i ? "L" : "M"}${xf(i).toFixed(1)},${yf(p.close).toFixed(1)}`).join("");
    return { path: d, x: xf, y: yf, min: lo, max: hi };
  }, [data]);

  if (data.length < 2) return <p className="empty">Not enough history to chart.</p>;
  const first = data[0]!;
  const last = data.at(-1)!;
  const change = last.close / first.close - 1;
  const point = hover === null ? null : data[hover]!;

  const onMove = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const rel = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((rel - PAD.l) / (W - PAD.l - PAD.r)) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };

  return (
    <div className="chart">
      <div className="chart-head">
        <div className="chart-read" aria-live="polite">
          {point ? (
            <>
              <strong>{money2(point.close)}</strong> <span className="sub">{longDate(point.date)}</span>{" "}
              <span className={point.close >= first.close ? "gain" : "loss"}>{percent(point.close / first.close - 1)}</span>
            </>
          ) : (
            <>
              <span className={change >= 0 ? "gain" : "loss"}>{change >= 0 ? "▲" : "▼"} {percent(change)}</span>{" "}
              <span className="sub">over {range}</span>
            </>
          )}
        </div>
        <div className="subnav small" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r.label} type="button" aria-pressed={range === r.label} onClick={() => setRange(r.label)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="chart-svg"
        role="img"
        aria-label={`Closing price over ${range}: from ${money2(first.close)} to ${money2(last.close)}, ${percent(change)}. Range ${money2(min)} to ${money2(max)}.`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <line x1={PAD.l} x2={W - PAD.r} y1={y(first.close)} y2={y(first.close)} className="chart-base" />
        <path key={range} d={path} pathLength={1} className="chart-line" />
        <text x={W - PAD.r} y={y(max) - 2} textAnchor="end" className="chart-tick">{money2(max)}</text>
        <text x={W - PAD.r} y={Math.min(H - 4, y(min) + 14)} textAnchor="end" className="chart-tick">{money2(min)}</text>
        {point && (
          <g>
            <line x1={x(hover!)} x2={x(hover!)} y1={PAD.t} y2={H - PAD.b} className="chart-cross" />
            <circle cx={x(hover!)} cy={y(point.close)} r={4.5} className="chart-dot" />
          </g>
        )}
        <circle cx={x(data.length - 1)} cy={y(last.close)} r={4} className="chart-end" />
      </svg>
    </div>
  );
}
