"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type Direction = "up" | "down";

const DIGIT = /\d/;
const ROLL_MS = 650;
const STAGGER_MS = 40;

type Phase = "idle" | "start" | "run";

interface Roll {
  from: string;
  to: string;
  dir: Direction;
  phase: Phase;
}

/**
 * Text whose digits roll like an odometer when it changes. Only the digits that
 * changed move; they roll up when the value rose and down when it fell, the ones
 * digit first and each place to its left a beat later. Separators and the ₹ sign
 * stay put.
 *
 * At rest every digit is a plain character, so a table full of numbers stays a
 * light DOM; a 30-cell strip exists only while a digit is rolling.
 */
export function Odometer({ text, dir }: { text: string; dir: Direction }) {
  const [roll, setRoll] = useState<Roll>({ from: text, to: text, dir, phase: "idle" });

  // New text: start a roll from what is on screen now (derived state, set during render).
  if (text !== roll.to) {
    setRoll({ from: roll.to, to: text, dir, phase: "start" });
  }

  // Strips mount at the old digit; one frame later they move, so the transition runs.
  useLayoutEffect(() => {
    if (roll.phase !== "start") return;
    const f = requestAnimationFrame(() => setRoll((r) => (r.phase === "start" ? { ...r, phase: "run" } : r)));
    return () => cancelAnimationFrame(f);
  }, [roll]);

  const digits = roll.to.length;
  useEffect(() => {
    if (roll.phase !== "run") return;
    const t = setTimeout(() => setRoll((r) => ({ ...r, from: r.to, phase: "idle" })), ROLL_MS + digits * STAGGER_MS + 60);
    return () => clearTimeout(t);
  }, [roll.phase, roll.to, digits]);

  const { from, to, phase } = roll;
  return (
    <span className="odo" aria-label={to} role="text">
      {Array.from(to, (ch, i) => {
        const place = to.length - 1 - i; // aligned from the right, so units stay units
        if (!DIGIT.test(ch)) {
          return <span key={`s${place}`} className="odo-c" aria-hidden>{ch}</span>;
        }
        const d = Number(ch);
        const prevCh = from[from.length - 1 - place];
        const f = prevCh && DIGIT.test(prevCh) ? Number(prevCh) : null;
        if (phase === "idle" || f === null || f === d) {
          return <span key={`d${place}`} className="odo-c" aria-hidden>{ch}</span>;
        }
        // The strip is 0–9 three times; rest sits in the middle block. Rolling up
        // moves forward (into the upper block when it wraps past 9), down moves back.
        const startAt = 10 + f;
        const target = roll.dir === "up" ? (d > f ? 10 + d : 20 + d) : d < f ? 10 + d : d;
        const at = phase === "start" ? startAt : target;
        return (
          <span key={`d${place}`} className={`odo-d rolling ${roll.dir}`} aria-hidden>
            <span className="odo-ghost">{ch}</span>
            <span
              className="odo-strip"
              style={{
                transform: `translateY(${-at * 100 / 30}%)`,
                transition: phase === "run" ? `transform ${ROLL_MS}ms cubic-bezier(0.2, 0.75, 0.25, 1) ${place * STAGGER_MS}ms` : "none",
              }}
            >
              {STRIP}
            </span>
          </span>
        );
      })}
    </span>
  );
}

const STRIP = Array.from({ length: 30 }, (_, k) => <span key={k}>{k % 10}</span>);

/** Remembers the last value so callers can say which way it moved. */
export function useDirection(value: number): Direction {
  const last = useRef(value);
  const dir = useRef<Direction>("up");
  if (value !== last.current) {
    dir.current = value > last.current ? "up" : "down";
    last.current = value;
  }
  return dir.current;
}
