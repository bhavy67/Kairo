import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/db.js";
import { backfill, refreshConstituents } from "./ingest.js";
import type { NseArchive } from "./nse-archive.js";

const TICK_MS = 15 * 60_000;
const CATCH_UP_DAYS = 10;
const CONSTITUENTS_MAX_AGE_DAYS = 7;

/**
 * In-process scheduler. Each tick: refresh constituents if stale, then fill any
 * missing day in the last 10. Because every step is idempotent and keyed by date,
 * a crash, restart or missed tick just means the next tick does the work.
 *
 * One process only. With several API replicas this would move behind a
 * Postgres advisory lock or into a separate worker.
 */
export function startScheduler(db: Db, nse: NseArchive, log: FastifyBaseLogger, now: () => number = Date.now) {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const [{ stale }] = await db.query<{ stale: boolean }>(
        `select coalesce(max(updated_at) < now() - make_interval(days => $1), true) as stale from instruments`,
        [CONSTITUENTS_MAX_AGE_DAYS],
      ) as [{ stale: boolean }];
      if (stale) log.info({ count: await refreshConstituents(db, nse) }, "constituents refreshed");
      await backfill(db, nse, { days: CATCH_UP_DAYS, now: now(), log });
    } catch (err) {
      log.error({ err }, "scheduler tick failed");
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
  return { stop: () => clearInterval(timer), tick };
}
