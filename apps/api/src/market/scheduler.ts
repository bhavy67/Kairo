import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/db.js";
import { runEodJob } from "./ingest.js";
import type { NseArchive } from "./nse-archive.js";

const TICK_MS = 15 * 60_000;
const CATCH_UP_DAYS = 10;

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
      await runEodJob(db, nse, { days: CATCH_UP_DAYS, now: now(), log });
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
