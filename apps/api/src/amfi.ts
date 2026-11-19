import { indexByIsin, parseAmfiNav, type NavRecord } from "@kairo/core";
import { UpstreamError } from "./errors.js";
import type { Fetch } from "./kite/client.js";

const TTL_MS = 6 * 60 * 60 * 1000; // AMFI publishes once a day, late evening IST

/**
 * Caches the ~2 MB AMFI file in memory. Concurrent callers during a refresh share
 * one in-flight request (single-flight), so a burst never fans out to AMFI.
 * If a refresh fails we keep serving the last good copy.
 */
export class AmfiNavService {
  private index: Map<string, NavRecord> | null = null;
  private fetchedAt = 0;
  private inflight: Promise<Map<string, NavRecord>> | null = null;

  constructor(
    private readonly url: string,
    private readonly fetchImpl: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async byIsin(isin: string): Promise<NavRecord | undefined> {
    return (await this.load()).get(isin);
  }

  private async load(): Promise<Map<string, NavRecord>> {
    if (this.index && this.now() - this.fetchedAt < TTL_MS) return this.index;
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async refresh(): Promise<Map<string, NavRecord>> {
    try {
      const res = await this.fetchImpl(this.url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.index = indexByIsin(parseAmfiNav(await res.text()));
      this.fetchedAt = this.now();
      return this.index;
    } catch (err) {
      if (this.index) return this.index;
      throw new UpstreamError(`AMFI NAV fetch failed: ${(err as Error).message}`);
    }
  }
}
