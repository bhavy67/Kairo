import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

/**
 * The slice of SQL access the app needs. Two implementations:
 * - node-postgres Pool against a real server (production, Docker)
 * - PGlite, Postgres compiled to WASM, in-process (tests and zero-setup dev)
 *
 * Both are real Postgres, so the same SQL (window functions, ON CONFLICT,
 * unnest) runs everywhere. Queries cast dates to text and bigints to float8:
 * drivers otherwise return JS Dates shifted by the local timezone and strings.
 */
export interface Db {
  query<T extends object>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Multi-statement SQL without parameters (migrations). */
  exec(sql: string): Promise<void>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function pgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000 });
  const wrap = (client: pg.Pool | pg.PoolClient): Omit<Db, "tx" | "close"> => ({
    async query<T extends object>(sql: string, params: unknown[] = []) {
      return (await client.query(sql, params)).rows as T[];
    },
    async exec(sql: string) {
      await client.query(sql);
    },
  });
  return {
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn({ ...wrap(client), tx: () => Promise.reject(new Error("nested tx")), close: async () => {} });
        await client.query("commit");
        return result;
      } catch (err) {
        await client.query("rollback");
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function pgliteDb(dataDir?: string): Promise<Db> {
  const lite = dataDir ? new PGlite(dataDir) : new PGlite();
  await lite.waitReady;
  type Q = Pick<PGlite, "query" | "exec">;
  const wrap = (q: Q): Omit<Db, "tx" | "close"> => ({
    async query<T extends object>(sql: string, params: unknown[] = []) {
      return (await q.query<T>(sql, params)).rows;
    },
    async exec(sql: string) {
      await q.exec(sql);
    },
  });
  return {
    ...wrap(lite),
    tx: (fn) => lite.transaction((t) => fn({ ...wrap(t as unknown as Q), tx: () => Promise.reject(new Error("nested tx")), close: async () => {} })),
    close: () => lite.close(),
  };
}
