import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.js";
import { pgDb, pgliteDb, type Db } from "./db.js";
import { migrate } from "./migrations.js";

export async function openDb(config: Config): Promise<Db> {
  let db: Db;
  if (config.DATABASE_URL) db = pgDb(config.DATABASE_URL);
  else {
    if (config.NODE_ENV === "production") throw new Error("DATABASE_URL is required in production");
    const dir = join(config.DATA_DIR, "pglite");
    mkdirSync(dir, { recursive: true });
    db = await pgliteDb(dir);
  }
  await migrate(db);
  return db;
}
