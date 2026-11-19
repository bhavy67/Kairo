import type { PortfolioSnapshot } from "@kairo/core";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", cache: "no-store" });
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
  logout: () => fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }),
};
