"use client";

import { useEffect, useRef, useState } from "react";
import { isMarketOpen } from "@/lib/format";
import { LIVE_MS } from "@/lib/usePortfolio";

type Flash = "gain" | "loss" | "flat" | null;

/**
 * The portfolio's refresh cycle, made visible. While NSE is open a ring drains over
 * the 30 seconds to the next fetch, spins while fetching, and the centre dot flashes
 * the direction of the change when new prices land. After the close there is
 * nothing to count down to, so it says so instead of ticking.
 *
 * The ring is a CSS animation keyed to the query's own `updatedAt`, so it cannot
 * drift from the real refetch: both start when the last fetch finished.
 */
export function LiveTimer({
  updatedAt,
  fetching,
  value,
  source,
  onRefresh,
}: {
  /** When the data on screen was fetched (epoch ms). */
  updatedAt: number;
  fetching: boolean;
  /** Portfolio value: its change colours the flash. */
  value: number;
  source: "live" | "snapshot" | "demo" | undefined;
  onRefresh: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [flash, setFlash] = useState<Flash>(null);
  const prev = useRef({ updatedAt, value });

  // One cheap tick a second for the digits; the ring itself animates in CSS.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // New data: flash its direction once, then settle.
  useEffect(() => {
    if (updatedAt === prev.current.updatedAt) return;
    const d = value - prev.current.value;
    prev.current = { updatedAt, value };
    setFlash(Math.abs(d) < 0.5 ? "flat" : d > 0 ? "gain" : "loss");
    setNow(Date.now());
    const t = setTimeout(() => setFlash(null), 1400);
    return () => clearTimeout(t);
  }, [updatedAt, value]);

  const snapshot = source === "snapshot";
  const live = !snapshot && isMarketOpen(new Date(now));
  const left = Math.max(0, Math.ceil((LIVE_MS - (now - updatedAt)) / 1000));
  const elapsed = Math.min(LIVE_MS, Math.max(0, now - updatedAt));

  const label = snapshot ? "Saved prices" : !live ? "Market closed" : fetching ? "Updating" : "Live";
  const title = snapshot
    ? "Kite is disconnected: showing the last saved holdings."
    : live
      ? "Prices refresh every 30 seconds while NSE is open. Click to refresh now."
      : "NSE is closed: prices refresh every 10 minutes. Click to refresh now.";

  return (
    <button
      type="button"
      className={`live ${live ? "on" : "off"} ${fetching ? "busy" : ""} ${flash ? `flash-${flash}` : ""}`}
      onClick={onRefresh}
      disabled={fetching}
      title={title}
      aria-label={`${label}. ${title}`}
    >
      <svg className="live-ring" viewBox="0 0 20 20" aria-hidden>
        <circle className="track" cx="10" cy="10" r="7.5" pathLength={1} />
        {live && !fetching && (
          // Restarted on every fetch; a negative delay picks up mid-cycle after a re-render.
          <circle
            key={updatedAt}
            className="drain"
            cx="10"
            cy="10"
            r="7.5"
            pathLength={1}
            style={{ animationDuration: `${LIVE_MS}ms`, animationDelay: `-${elapsed}ms` }}
          />
        )}
        {fetching && <circle className="spin" cx="10" cy="10" r="7.5" pathLength={1} />}
        <circle className="core" cx="10" cy="10" r="2.6" />
      </svg>
      <span className="live-label">{label}</span>
      {live && !fetching && <span className="live-secs">{left}s</span>}
    </button>
  );
}
