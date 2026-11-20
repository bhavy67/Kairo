import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import type { Db } from "./db/db.js";

/**
 * Two separate lifetimes (ADR 11):
 * - the Kairo session proves who you are; it lasts 30 days and slides while used;
 * - the Kite token lets Kairo read your broker account; Zerodha expires it daily.
 * Losing the second no longer logs you out of the first.
 */
export const SESSION_DAYS = 30;
const DAY_MS = 86_400_000;
/** Extend the session at most once a day, so reads are not all writes. */
const RENEW_AFTER_MS = DAY_MS;

export interface Session {
  id: string;
  userId: string;
  userName: string;
  /** Kairo session expiry (epoch ms). */
  expiresAt: number;
  /** Kite access token, or null when it has expired or was never attached. */
  kiteToken: string | null;
  kiteExpiresAt: number | null;
  /** Set when this read extended the session, so the cookie can be re-issued. */
  renewed: boolean;
}

/**
 * Kite access tokens are invalidated daily around 06:00 IST (00:30 UTC).
 */
export function nextKiteExpiry(now: number): number {
  const d = new Date(now);
  const candidate = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 30);
  return candidate > now ? candidate : candidate + DAY_MS;
}

const hashId = (id: string) => createHash("sha256").update(id).digest("base64url");
const ts = (ms: number) => ms / 1000;

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

interface Row {
  user_id: string;
  user_name: string;
  token_enc: string | null;
  expires_ms: number;
  kite_ms: number | null;
  seen_ms: number;
}

/**
 * Postgres-backed sessions. The id is stored only as a SHA-256 hash and the
 * Kite token only encrypted, so a database leak yields neither.
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

  async create(data: { userId: string; userName: string; kiteToken: string }): Promise<Session> {
    const id = randomBytes(32).toString("base64url");
    const now = this.now();
    const expiresAt = now + SESSION_DAYS * DAY_MS;
    const kiteExpiresAt = nextKiteExpiry(now);
    // Opportunistic cleanup keeps the table tiny without a separate job.
    await this.db.query("delete from sessions where expires_at <= to_timestamp($1)", [ts(now)]);
    await this.db.query(
      `insert into sessions (id_hash, user_id, user_name, token_enc, expires_at, kite_expires_at, last_seen_at)
       values ($1, $2, $3, $4, to_timestamp($5), to_timestamp($6), to_timestamp($7))`,
      [hashId(id), data.userId, data.userName, this.cipher.seal(data.kiteToken), ts(expiresAt), ts(kiteExpiresAt), ts(now)],
    );
    return { id, userId: data.userId, userName: data.userName, expiresAt, kiteToken: data.kiteToken, kiteExpiresAt, renewed: false };
  }

  async get(id: string | undefined): Promise<Session | undefined> {
    if (!id) return undefined;
    const now = this.now();
    const [row] = await this.db.query<Row>(
      `select user_id, user_name, token_enc,
              (extract(epoch from expires_at) * 1000)::float8 as expires_ms,
              (extract(epoch from kite_expires_at) * 1000)::float8 as kite_ms,
              (extract(epoch from last_seen_at) * 1000)::float8 as seen_ms
       from sessions where id_hash = $1 and expires_at > to_timestamp($2)`,
      [hashId(id), ts(now)],
    );
    if (!row) return undefined;

    let kiteToken: string | null = null;
    if (row.token_enc && row.kite_ms !== null && row.kite_ms > now) {
      try {
        kiteToken = this.cipher.open(row.token_enc);
      } catch {
        // Secret rotated or row tampered with: the broker link is unusable, the session is not.
        kiteToken = null;
      }
    }

    let expiresAt = row.expires_ms;
    let renewed = false;
    if (now - row.seen_ms >= RENEW_AFTER_MS) {
      expiresAt = now + SESSION_DAYS * DAY_MS;
      renewed = true;
      await this.db.query("update sessions set expires_at = to_timestamp($2), last_seen_at = to_timestamp($3) where id_hash = $1", [
        hashId(id),
        ts(expiresAt),
        ts(now),
      ]);
    }
    return {
      id,
      userId: row.user_id,
      userName: row.user_name,
      expiresAt,
      kiteToken,
      kiteExpiresAt: kiteToken ? row.kite_ms : null,
      renewed,
    };
  }

  /** Reconnect: a fresh Kite token on an existing session. */
  async attachKite(id: string, kiteToken: string): Promise<number> {
    const kiteExpiresAt = nextKiteExpiry(this.now());
    await this.db.query("update sessions set token_enc = $2, kite_expires_at = to_timestamp($3) where id_hash = $1", [
      hashId(id),
      this.cipher.seal(kiteToken),
      ts(kiteExpiresAt),
    ]);
    return kiteExpiresAt;
  }

  /** The broker rejected the token: forget it, keep the session. */
  async dropKite(id: string): Promise<void> {
    await this.db.query("update sessions set token_enc = null, kite_expires_at = null where id_hash = $1", [hashId(id)]);
  }

  async delete(id: string): Promise<void> {
    await this.db.query("delete from sessions where id_hash = $1", [hashId(id)]);
  }

  /** Sign out everywhere. */
  async deleteForUser(userId: string): Promise<number> {
    return (await this.db.query("delete from sessions where user_id = $1 returning user_id", [userId])).length;
  }
}
