import type { AlertKind, AlertRule, ScreenRule } from "@kairo/core";
import type { Db } from "../db/db.js";

export interface SavedScreen {
  id: number;
  name: string;
  rule: ScreenRule;
  alert: boolean;
  createdAt: string;
}

export interface AlertView extends AlertRule {
  active: boolean;
  createdAt: string;
}

export interface AlertEvent {
  id: number;
  date: string;
  symbol: string;
  message: string;
  source: "alert" | "screen";
  deliveredAt: string | null;
}

export class SignalsRepo {
  constructor(private readonly db: Db) {}

  screens(): Promise<SavedScreen[]> {
    return this.db.query<SavedScreen>(
      `select id::int as id, name, rule, alert, created_at::text as "createdAt" from screens order by created_at`,
    );
  }

  async screen(id: number): Promise<SavedScreen | undefined> {
    const [s] = await this.db.query<SavedScreen>(
      `select id::int as id, name, rule, alert, created_at::text as "createdAt" from screens where id = $1`,
      [id],
    );
    return s;
  }

  async addScreen(name: string, rule: ScreenRule, alert: boolean): Promise<number> {
    const [r] = await this.db.query<{ id: number }>(
      "insert into screens (name, rule, alert) values ($1, $2::jsonb, $3) returning id::int as id",
      [name, JSON.stringify(rule), alert],
    );
    return r!.id;
  }

  async removeScreen(id: number): Promise<boolean> {
    return (await this.db.query("delete from screens where id = $1 returning id", [id])).length > 0;
  }

  alerts(): Promise<AlertView[]> {
    return this.db.query<AlertView>(
      `select id::int as id, symbol, kind, threshold, active, created_at::text as "createdAt" from alerts order by created_at`,
    );
  }

  activeAlerts(): Promise<AlertRule[]> {
    return this.db.query<AlertRule>("select id::int as id, symbol, kind, threshold from alerts where active");
  }

  async addAlert(symbol: string, kind: AlertKind, threshold: number | null): Promise<number> {
    const [r] = await this.db.query<{ id: number }>(
      "insert into alerts (symbol, kind, threshold) values ($1, $2, $3) returning id::int as id",
      [symbol, kind, threshold],
    );
    return r!.id;
  }

  async removeAlert(id: number): Promise<boolean> {
    return (await this.db.query("delete from alerts where id = $1 returning id", [id])).length > 0;
  }

  events(limit = 50): Promise<AlertEvent[]> {
    return this.db.query<AlertEvent>(
      `select id::int as id, date::text as date, symbol, message,
              case when alert_id is not null then 'alert' else 'screen' end as source,
              delivered_at::text as "deliveredAt"
       from alert_events order by date desc, id desc limit $1`,
      [limit],
    );
  }

  /** Insert events; duplicates for the same source/day/symbol are ignored. Returns how many were new. */
  async recordEvents(
    date: string,
    events: { alertId?: number; screenId?: number; symbol: string; message: string }[],
  ): Promise<number> {
    if (events.length === 0) return 0;
    const rows = await this.db.query(
      `insert into alert_events (alert_id, screen_id, date, symbol, message)
       select * from unnest($1::bigint[], $2::bigint[], $3::date[], $4::text[], $5::text[])
       on conflict do nothing returning id`,
      [
        events.map((e) => e.alertId ?? null),
        events.map((e) => e.screenId ?? null),
        events.map(() => date),
        events.map((e) => e.symbol),
        events.map((e) => e.message),
      ],
    );
    return rows.length;
  }

  pendingDelivery(limit = 30): Promise<{ id: number; message: string; date: string }[]> {
    return this.db.query(
      `select id::int as id, message, date::text as date from alert_events
       where delivered_at is null order by created_at limit $1`,
      [limit],
    );
  }

  async markDelivered(ids: number[]): Promise<void> {
    if (ids.length) await this.db.query("update alert_events set delivered_at = now() where id = any($1::bigint[])", [ids]);
  }

  async previousResult(screenId: number, before: string): Promise<string[] | null> {
    const [r] = await this.db.query<{ symbols: string[] }>(
      "select symbols from screen_results where screen_id = $1 and date < $2 order by date desc limit 1",
      [screenId, before],
    );
    return r?.symbols ?? null;
  }

  async saveResult(screenId: number, date: string, symbols: string[]): Promise<void> {
    await this.db.query(
      `insert into screen_results (screen_id, date, symbols) values ($1, $2, $3::text[])
       on conflict (screen_id, date) do update set symbols = excluded.symbols`,
      [screenId, date, symbols],
    );
  }
}
