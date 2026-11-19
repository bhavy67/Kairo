import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/db.js";
import { runEodJob } from "./ingest.js";
import type { MarketRepo } from "./repo.js";
import { runAlertJob } from "../signals/job.js";
import { runGlobalJob, type GlobalSources } from "../global/ingest.js";
import type { Notifier } from "../signals/notifier.js";
import type { SignalsRepo } from "../signals/repo.js";
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
export interface SchedulerDeps {
  db: Db;
  nse: NseArchive;
  market: MarketRepo;
  signals: SignalsRepo;
  notifier: Notifier | null;
  global: GlobalSources;
  log: FastifyBaseLogger;
  now?: () => number;
}

export function startScheduler({ db, nse, market, signals, notifier, global, log, now = Date.now }: SchedulerDeps) {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const job = await runEodJob(db, nse, { days: CATCH_UP_DAYS, now: now(), log });
      if (job.reparsed > 0 || job.results.some((r) => r.status === "ok")) await market.refreshSnapshot();
      const latest = await market.latestDate();
      if (latest) {
        const alerts = await runAlertJob(db, signals, latest, notifier);
        if (alerts.newEvents) log.info(alerts, "alerts evaluated");
      }
      const g = await runGlobalJob(db, global, now());
      if (g.failed.length) log.warn({ failed: g.failed }, "global series refresh failed");
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
