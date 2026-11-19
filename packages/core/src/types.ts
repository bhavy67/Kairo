/**
 * Broker-agnostic domain types. Adapters (Kite, demo, future brokers) map
 * their payloads into these shapes, so nothing above the adapter layer
 * depends on a vendor's field names.
 */

export type Exchange = "NSE" | "BSE";

export interface Holding {
  symbol: string;
  exchange: Exchange;
  isin: string;
  /** Settled + unsettled (T1) quantity. */
  quantity: number;
  averagePrice: number;
  lastPrice: number;
  previousClose: number;
}

export interface FundHolding {
  folio: string;
  fund: string;
  isin: string;
  units: number;
  averageNav: number;
  lastNav: number;
  /** ISO date (YYYY-MM-DD) the last NAV belongs to. */
  navDate: string;
}

export interface Position {
  symbol: string;
  exchange: string;
  product: string;
  quantity: number;
  averagePrice: number;
  lastPrice: number;
  pnl: number;
}

export interface Profile {
  userId: string;
  name: string;
  broker: string;
}

export interface Funds {
  available: number;
  used: number;
}

export interface Cashflow {
  date: Date;
  /** Negative for money invested, positive for money received. */
  amount: number;
}
