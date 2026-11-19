import { randomBytes } from "node:crypto";

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

/**
 * In-memory store. Deliberate: one user, one process, and the token dies daily anyway,
 * so a restart costs one extra login. Persisting broker tokens to disk would add an
 * encryption-at-rest problem for no real benefit at this stage.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly now: () => number = Date.now) {}

  create(data: Omit<Session, "id" | "expiresAt">): Session {
    const session: Session = { ...data, id: randomBytes(32).toString("base64url"), expiresAt: nextKiteExpiry(this.now()) };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string | undefined): Session | undefined {
    if (!id) return undefined;
    const s = this.sessions.get(id);
    if (s && s.expiresAt <= this.now()) {
      this.sessions.delete(id);
      return undefined;
    }
    return s;
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }
}
