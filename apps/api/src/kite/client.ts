import { createHash } from "node:crypto";
import type { z } from "zod";
import { SessionExpiredError, UpstreamError } from "../errors.js";
import {
  KiteEnvelope,
  KiteHolding,
  KiteMargins,
  KiteMfHolding,
  KitePositions,
  KiteProfile,
  KiteSession,
} from "./schemas.js";

const API_ROOT = "https://api.kite.trade";
const LOGIN_ROOT = "https://kite.zerodha.com/connect/login";

export type Fetch = typeof fetch;

/** SHA-256 of api_key + request_token + api_secret, as Kite's token exchange requires. */
export function sessionChecksum(apiKey: string, requestToken: string, apiSecret: string): string {
  return createHash("sha256").update(apiKey + requestToken + apiSecret).digest("hex");
}

export function loginUrl(apiKey: string, state: string): string {
  const params = new URLSearchParams({
    v: "3",
    api_key: apiKey,
    // Kite echoes redirect_params back on the callback; we use it to carry the CSRF state.
    redirect_params: new URLSearchParams({ state }).toString(),
  });
  return `${LOGIN_ROOT}?${params}`;
}

/**
 * Thin, typed wrapper over Kite Connect v3 REST.
 * We use fetch directly rather than the official SDK: the surface we need is small,
 * and owning it lets us validate every response and map errors to our own types.
 */
export class KiteClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async createSession(requestToken: string, apiSecret: string) {
    const body = new URLSearchParams({
      api_key: this.apiKey,
      request_token: requestToken,
      checksum: sessionChecksum(this.apiKey, requestToken, apiSecret),
    });
    return this.request(KiteSession, "POST", "/session/token", undefined, body);
  }

  async invalidateSession(accessToken: string): Promise<void> {
    const qs = new URLSearchParams({ api_key: this.apiKey, access_token: accessToken });
    await this.request(null, "DELETE", `/session/token?${qs}`, accessToken).catch(() => undefined);
  }

  profile(token: string) {
    return this.request(KiteProfile, "GET", "/user/profile", token);
  }
  margins(token: string) {
    return this.request(KiteMargins, "GET", "/user/margins", token);
  }
  holdings(token: string) {
    return this.request(KiteHolding.array(), "GET", "/portfolio/holdings", token);
  }
  positions(token: string) {
    return this.request(KitePositions, "GET", "/portfolio/positions", token);
  }
  mfHoldings(token: string) {
    return this.request(KiteMfHolding.array(), "GET", "/mf/holdings", token);
  }

  private async request<S extends z.ZodType>(
    schema: S | null,
    method: string,
    path: string,
    accessToken?: string,
    body?: URLSearchParams,
  ): Promise<z.infer<S>> {
    const headers: Record<string, string> = { "X-Kite-Version": "3" };
    if (accessToken) headers.Authorization = `token ${this.apiKey}:${accessToken}`;

    let res: Response;
    try {
      res = await this.fetchImpl(`${API_ROOT}${path}`, {
        method,
        headers,
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new UpstreamError(`Kite unreachable: ${(err as Error).message}`);
    }

    const json: unknown = await res.json().catch(() => null);
    const env = KiteEnvelope.safeParse(json);
    if (!env.success) throw new UpstreamError(`Unexpected Kite response (HTTP ${res.status}) for ${path}`);
    if (env.data.status === "error") {
      if (env.data.error_type === "TokenException") throw new SessionExpiredError();
      throw new UpstreamError(`Kite ${env.data.error_type}: ${env.data.message}`);
    }
    if (!schema) return undefined as z.infer<S>;
    const data = schema.safeParse(env.data.data);
    if (!data.success) throw new UpstreamError(`Kite response for ${path} failed validation`);
    return data.data;
  }
}
