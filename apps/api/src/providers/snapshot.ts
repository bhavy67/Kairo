import type { FundHolding, Funds, Holding } from "@kairo/core";
import type { AmfiNavService } from "../amfi.js";
import type { Db } from "../db/db.js";
import { AppError } from "../errors.js";
import { istDate } from "../market/calendar.js";
import type { PortfolioProvider } from "./types.js";

export interface SnapshotPayload {
  holdings: Holding[];
  funds: FundHolding[];
  cash: Funds;
}

export class SnapshotStore {
  constructor(private readonly db: Db) {}

  async save(userId: string, payload: SnapshotPayload): Promise<void> {
    await this.db.query(
      `insert into holdings_snapshots (user_id, payload, taken_at) values ($1, $2::jsonb, now())
       on conflict (user_id) do update set payload = excluded.payload, taken_at = excluded.taken_at`,
      [userId, JSON.stringify(payload)],
    );
  }

  async load(userId: string): Promise<{ payload: SnapshotPayload; takenAt: string } | null> {
    const [row] = await this.db.query<{ payload: SnapshotPayload; taken_at: string }>(
      `select payload, to_char(taken_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as taken_at
       from holdings_snapshots where user_id = $1`,
      [userId],
    );
    return row ? { payload: row.payload, takenAt: row.taken_at } : null;
  }
}

export class BrokerDisconnectedError extends AppError {
  constructor() {
    super(409, "broker_disconnected", "Connect Kite once to load your holdings.");
  }
}

/**
 * Serves the last saved holdings without a Kite token. Quantities rarely change,
 * so the snapshot is revalued with data Kairo already has: the latest NSE close
 * for stocks and the latest AMFI NAV for funds, whenever those are newer.
 */
export function snapshotProvider(db: Db, amfi: AmfiNavService, store: SnapshotStore, userId: string, userName: string): PortfolioProvider {
  let cached: Promise<{ payload: SnapshotPayload; takenAt: string }> | null = null;
  const load = () =>
    (cached ??= store.load(userId).then((s) => {
      if (!s) throw new BrokerDisconnectedError();
      return s;
    }));

  return {
    async profile() {
      return { userId, name: userName, broker: "ZERODHA" };
    },
    async funds() {
      return (await load()).payload.cash;
    },
    async holdings() {
      const { payload, takenAt } = await load();
      const takenDay = istDate(Date.parse(takenAt));
      const symbols = payload.holdings.map((h) => h.symbol);
      const bars = symbols.length
        ? await db.query<{ symbol: string; date: string; close: number; prev_close: number }>(
            `select distinct on (symbol) symbol, date::text as date, close, prev_close
             from daily_bars where symbol = any($1::text[]) and date > current_date - 15
             order by symbol, date desc`,
            [symbols],
          )
        : [];
      const bySymbol = new Map(bars.map((b) => [b.symbol, b]));
      return payload.holdings.map((h) => {
        const bar = bySymbol.get(h.symbol);
        // Only newer data replaces the snapshot's price (a mid-session snapshot beats yesterday's close).
        return bar && bar.date >= takenDay ? { ...h, lastPrice: bar.close, previousClose: bar.prev_close } : h;
      });
    },
    async fundHoldings() {
      const { payload } = await load();
      return Promise.all(
        payload.funds.map(async (f) => {
          const nav = await amfi.byIsin(f.isin).catch(() => undefined);
          return nav && nav.date >= f.navDate ? { ...f, lastNav: nav.nav, navDate: nav.date } : f;
        }),
      );
    },
    async positions() {
      return []; // intraday positions are meaningless without a live broker connection
    },
  };
}
