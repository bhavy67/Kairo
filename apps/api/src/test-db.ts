import { pgliteDb, type Db } from "./db/db.js";
import { migrate } from "./db/migrations.js";

/** A fresh, migrated, in-memory Postgres per call. */
export async function testDb(): Promise<Db> {
  const db = await pgliteDb();
  await migrate(db);
  return db;
}
