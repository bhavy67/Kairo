/**
 * Load EOD history from the NSE archive.
 *   pnpm --filter @kairo/api backfill            # last 400 calendar days (~270 sessions)
 *   pnpm --filter @kairo/api backfill -- --days 30
 */
import { parseArgs } from "node:util";
import { loadConfig } from "../config.js";
import { openDb } from "../db/open.js";
import { backfill, refreshConstituents } from "../market/ingest.js";
import { NseArchive } from "../market/nse-archive.js";

// pnpm forwards a literal "--" separator; drop it.
const args = process.argv.slice(2).filter((a) => a !== "--");
const { values } = parseArgs({ args, options: { days: { type: "string", default: "400" } } });
const days = Number(values.days);
if (!Number.isInteger(days) || days < 1 || days > 2000) throw new Error("--days must be 1..2000");

const config = loadConfig();
const db = await openDb(config);
const nse = new NseArchive(config.NSE_ARCHIVE_URL);
const log = { info: (o: object, m?: string) => console.log(m ?? "", JSON.stringify(o)), warn: (o: object, m?: string) => console.warn(m ?? "", JSON.stringify(o)) };

console.log(`constituents: ${await refreshConstituents(db, nse)}`);
const results = await backfill(db, nse, { days, log: log as never });
const by = (s: string) => results.filter((r) => r.status === s).length;
console.log(`done: ${by("ok")} ok, ${by("skipped")} skipped, ${by("failed")} failed, ${by("pending")} pending`);
await db.close();
process.exit(by("failed") > 0 ? 1 : 0);
