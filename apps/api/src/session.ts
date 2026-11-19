import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import type { Db } from "./db/db.js";

export interface Session {
  id: string;
  userId: string;
  userName: string;
  accessToken: string;
  expiresAt: number;
}

/**
 * Kite access tokens are invalidated daily around 06:00 IST (00:30 UTC).
 * We expire our session at the same moment so the UI asks for login
 * instead of failing every request with a broker error.
 */
export function nextKiteExpiry(now: number): number {
  const d = new Date(now);
  const candidate = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 30);
  return candidate > now ? candidate : candidate + 86_400_000;
}

const hashId = (id: string) => createHash("sha256").update(id).digest("base64url");

/** AES-256-GCM with a fresh 12-byte IV per value; output is iv | tag | ciphertext. */
class TokenCipher {
  private readonly key: Buffer;
  constructor(secret: string) {
    this.key = Buffer.from(hkdfSync("sha256", secret, "kairo", "session-token-v1", 32));
  }
  seal(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
  }
  open(sealed: string): string {
    const buf = Buffer.from(sealed, "base64");
    const d = createDecipheriv("aes-256-gcm", this.key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
  }
}

/**
 * Postgres-backed sessions. Stateless app instances (Vercel functions, several
 * containers) all see the same sessions, and a restart no longer logs you out.
 */
export class SessionStore {
  private readonly cipher: TokenCipher;

  constructor(
    private readonly db: Db,
    secret: string,
    private readonly now: () => number = Date.now,
  ) {
    this.cipher = new TokenCipher(secret);
  }

  async create(data: Omit<Session, "id" | "expiresAt">): Promise<Session> {
    const id = randomBytes(32).toString("base64url");
    const expiresAt = nextKiteExpiry(this.now());
    // Opportunistic cleanup keeps the table tiny without a separate job.
    await this.db.query("delete from sessions where expires_at <= to_timestamp($1 / 1000.0)", [this.now()]);
    await this.db.query(
      `insert into sessions (id_hash, user_id, user_name, token_enc, expires_at)
       values ($1, $2, $3, $4, to_timestamp($5 / 1000.0))`,
      [hashId(id), data.userId, data.userName, this.cipher.seal(data.accessToken), expiresAt],
    );
    return { ...data, id, expiresAt };
  }

  async get(id: string | undefined): Promise<Session | undefined> {
    if (!id) return undefined;
    const [row] = await this.db.query<{ user_id: string; user_name: string; token_enc: string; expires_ms: number }>(
      `select user_id, user_name, token_enc, (extract(epoch from expires_at) * 1000)::float8 as expires_ms
       from sessions where id_hash = $1 and expires_at > to_timestamp($2 / 1000.0)`,
      [hashId(id), this.now()],
    );
    if (!row) return undefined;
    try {
      return { id, userId: row.user_id, userName: row.user_name, accessToken: this.cipher.open(row.token_enc), expiresAt: row.expires_ms };
    } catch {
      // Secret rotated or row tampered with: treat as signed out.
      await this.delete(id);
      return undefined;
    }
  }

  async delete(id: string): Promise<void> {
    await this.db.query("delete from sessions where id_hash = $1", [hashId(id)]);
  }
}
