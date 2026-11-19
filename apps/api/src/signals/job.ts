import { evaluateAlerts, newMatches, runScreen } from "@kairo/core";
import type { Db } from "../db/db.js";
import { loadRows, loadSymbols } from "../market/indicators.js";
import type { Notifier } from "./notifier.js";
import type { SignalsRepo } from "./repo.js";

export interface AlertJobResult {
  date: string;
  newEvents: number;
  delivered: number;
}

/**
 * Runs after indicators for `date` exist. Idempotent: events are unique per
 * source/day/symbol, and delivery only sends rows not yet marked delivered,
 * so a retried cron run neither duplicates events nor re-sends messages.
 */
export async function runAlertJob(db: Db, repo: SignalsRepo, date: string, notifier: Notifier | null): Promise<AlertJobResult> {
  const events: { alertId?: number; screenId?: number; symbol: string; message: string }[] = [];

  const rules = await repo.activeAlerts();
  const bySymbol = await loadSymbols(db, date, [...new Set(rules.map((r) => r.symbol))]);
  for (const hit of evaluateAlerts(rules, bySymbol)) events.push({ alertId: hit.alertId, symbol: hit.symbol, message: hit.message });

  for (const screen of (await repo.screens()).filter((s) => s.alert)) {
    const matched = runScreen(await loadRows(db, date, screen.rule.universe), screen.rule).map((r) => r.symbol);
    const fresh = newMatches(matched, await repo.previousResult(screen.id, date));
    await repo.saveResult(screen.id, date, matched);
    for (const symbol of fresh) events.push({ screenId: screen.id, symbol, message: `${symbol} entered "${screen.name}"` });
  }

  const newEvents = await repo.recordEvents(date, events);

  let delivered = 0;
  if (notifier) {
    const pending = await repo.pendingDelivery();
    if (pending.length) {
      // One message per run, not one per event: a busy day should not mean 20 pings.
      const text = [`Kairo · ${pending[0]!.date}`, ...pending.map((p) => `• ${p.message}`)].join("\n");
      if (await notifier.send(text)) {
        await repo.markDelivered(pending.map((p) => p.id));
        delivered = pending.length;
      }
    }
  }
  return { date, newEvents, delivered };
}
