import type { AlertKind, IngestRun, MarketOverview, PortfolioSnapshot, ScreenRow, ScreenRule, WatchItem } from "@kairo/core";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const send = <T>(path: string, method: string, body?: unknown) =>
  getJson<T>(path, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });

export interface PresetResult {
  id: string;
  name: string;
  description: string;
  rule: ScreenRule;
  total: number;
  rows: ScreenRow[];
}
export interface SavedScreen {
  id: number;
  name: string;
  rule: ScreenRule;
  alert: boolean;
}
export interface AlertView {
  id: number;
  symbol: string;
  kind: AlertKind;
  threshold: number | null;
}
export interface AlertEvent {
  id: number;
  date: string;
  symbol: string;
  message: string;
  source: "alert" | "screen";
  deliveredAt: string | null;
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
  today: () => getJson<{ asOf: string | null; presets: PresetResult[] }>("/api/screens/today"),
  runScreen: (rule: ScreenRule) => send<{ asOf: string | null; rows: ScreenRow[] }>("/api/screens/run", "POST", rule),
  screens: () => getJson<{ screens: SavedScreen[] }>("/api/screens"),
  saveScreen: (s: { name: string; rule: ScreenRule; alert: boolean }) => send<{ id: number }>("/api/screens", "POST", s),
  deleteScreen: (id: number) => send<void>(`/api/screens/${id}`, "DELETE"),
  alerts: () => getJson<{ alerts: AlertView[]; events: AlertEvent[]; channel: string | null }>("/api/alerts"),
  addAlert: (a: { symbol: string; kind: AlertKind; threshold: number | null }) => send<{ id: number }>("/api/alerts", "POST", a),
  deleteAlert: (id: number) => send<void>(`/api/alerts/${id}`, "DELETE"),
  logout: () => fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }),
};
