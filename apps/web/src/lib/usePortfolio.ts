"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { isMarketOpen } from "./format";

/** Poll fast while NSE is open, slowly otherwise: prices don't move after the close. */
export function usePortfolio() {
  return useQuery({
    queryKey: ["portfolio"],
    queryFn: api.portfolio,
    refetchInterval: () => (isMarketOpen() ? 30_000 : 10 * 60_000),
  });
}
