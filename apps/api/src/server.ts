import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db/open.js";
import { NseArchive } from "./market/nse-archive.js";
import { MarketRepo } from "./market/repo.js";
import { telegramNotifier } from "./signals/notifier.js";
import { SignalsRepo } from "./signals/repo.js";
import { startScheduler } from "./market/scheduler.js";

const config = loadConfig();
const db = await openDb(config);
const app = await buildApp({ config, db });
const scheduler = config.INGEST_SCHEDULE
  ? startScheduler({
      db,
      nse: new NseArchive(config.NSE_ARCHIVE_URL),
      market: new MarketRepo(db),
      signals: new SignalsRepo(db),
      notifier: config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID ? telegramNotifier(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID) : null,
      global: { fredUrl: config.FRED_URL, fxUrl: config.FX_URL, fetch },
      log: app.log,
    })
  : null;

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  scheduler?.stop();
  await app.close();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: config.PORT, host: config.HOST });
app.log.info(`kairo api in ${config.DATA_MODE} mode, db: ${config.DATABASE_URL ? "postgres" : "pglite"}`);
