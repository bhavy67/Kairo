import type { IngestRun, MarketOverview, PortfolioSnapshot, WatchItem } from "@kairo/core";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (!res.ok) throw new ApiError(res.status, body?.error ?? "http_error", body?.message ?? `HTTP ${res.status}`);
  return body as T;
}

export interface Me {
  authenticated: boolean;
  mode: "demo" | "kite";
  user?: { id: string; name: string };
  expiresAt?: string;
}

export const api = {
  me: () => getJson<Me>("/api/auth/me"),
  portfolio: () => getJson<PortfolioSnapshot>("/api/portfolio"),
  market: () => getJson<MarketOverview>("/api/market/overview"),
  ingestRuns: () => getJson<{ runs: IngestRun[] }>("/api/market/ingest"),
  watchlist: () => getJson<{ items: WatchItem[] }>("/api/watchlist"),
  addWatch: (symbol: string) =>
    getJson<{ symbol: string }>("/api/watchlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol }),
    }),
  removeWatch: (symbol: string) => getJson<void>(`/api/watchlist/${encodeURIComponent(symbol)}`, { method: "DELETE" }),
  logout: () => fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }),
};
