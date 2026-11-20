import type { FundHolding, Funds, Holding, Position, Profile } from "@kairo/core";

/**
 * Everything the app needs from a broker. Routes depend on this, never on Kite,
 * so the demo provider (and a future second broker) slot in without route changes.
 */
export interface PortfolioProvider {
  profile(): Promise<Profile>;
  funds(): Promise<Funds>;
  holdings(): Promise<Holding[]>;
  fundHoldings(): Promise<FundHolding[]>;
  positions(): Promise<Position[]>;
  /** Where the data came from, once the calls for a request have run. */
  status?(): ProviderStatus;
}

export interface ProviderStatus {
  source: "live" | "snapshot" | "demo";
}
