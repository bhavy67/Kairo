"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { isMarketOpen, msToOpenToday } from "./format";

/** Holdings prices while NSE is open: Kite's last traded price moves every few seconds. */
export const LIVE_MS = 30_000;
/** After the close prices do not move; a slow poll only catches late corrections. */
export const IDLE_MS = 10 * 60_000;

/** The polling interval right now. Wakes up at 09:15 instead of up to 10 minutes late. */
export function refreshInterval(now = new Date()): number {
  if (isMarketOpen(now)) return LIVE_MS;
  const toOpen = msToOpenToday(now);
  return toOpen !== null && toOpen < IDLE_MS ? Math.max(1_000, toOpen + 1_000) : IDLE_MS;
}

export function usePortfolio() {
  return useQuery({
    queryKey: ["portfolio"],
    queryFn: api.portfolio,
    refetchInterval: () => refreshInterval(),
  });
}
