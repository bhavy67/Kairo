import { SessionExpiredError } from "../errors.js";
import type { PortfolioProvider, ProviderStatus } from "./types.js";

/**
 * Live broker data when the Kite token works; the saved snapshot when it does not.
 * The first rejected call drops the token (onExpired) and every later call in the
 * request goes straight to the snapshot, so one request never mixes retries.
 */
export function resilientProvider(live: PortfolioProvider | null, fallback: () => PortfolioProvider, onExpired: () => Promise<void>): PortfolioProvider {
  let usingLive = live !== null;
  let snapshot: PortfolioProvider | null = null;
  const fb = () => (snapshot ??= fallback());

  const call = async <T>(pick: (p: PortfolioProvider) => Promise<T>): Promise<T> => {
    if (usingLive && live) {
      try {
        return await pick(live);
      } catch (err) {
        if (!(err instanceof SessionExpiredError)) throw err;
        usingLive = false;
        await onExpired();
      }
    }
    return pick(fb());
  };

  return {
    profile: () => call((p) => p.profile()),
    funds: () => call((p) => p.funds()),
    holdings: () => call((p) => p.holdings()),
    fundHoldings: () => call((p) => p.fundHoldings()),
    positions: () => call((p) => p.positions()),
    status: (): ProviderStatus => ({ source: usingLive ? "live" : "snapshot" }),
  };
}
