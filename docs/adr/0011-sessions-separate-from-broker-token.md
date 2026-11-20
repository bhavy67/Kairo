# 11. Separate the Kairo session from the Kite token

**Status:** accepted (supersedes the session lifetime in ADR 9's era)

## Context
Zerodha invalidates every Kite Connect access token around 06:00 IST, and personal apps get no refresh token. Kairo tied its own login to that token, so every morning the user was logged out of everything, even pages that never touch the broker (markets, screener, returns, plan).

Automating the Kite login (storing the password and TOTP secret server-side) would remove the daily step, but it breaks Zerodha's terms and puts the keys to a trading account on a cloud server. Rejected.

## Decision
Two lifetimes, stored together but independent:

| | Kairo session | Kite token |
|---|---|---|
| Proves | who you are (an allowed Kite user signed in once) | permission to read the broker account |
| Lifetime | 30 days, sliding (renewed at most once a day while used) | until ~06:00 IST |
| Storage | `sessions.id_hash` (SHA-256 of the cookie value) | `sessions.token_enc` (AES-256-GCM), `kite_expires_at` |
| When it ends | sign out, sign out everywhere, 30 idle days | daily, or when Kite rejects it |

- **Snapshot fallback.** Every successful live portfolio fetch saves holdings, funds and cash to `holdings_snapshots`. Without a working token, `resilientProvider` serves the snapshot, revalued with data Kairo already has: the latest NSE close per stock and the latest AMFI NAV per fund, whenever newer than the snapshot. The response says `source: "snapshot"` and when it was taken.
- **Rejected token mid-request.** The first `TokenException` drops the token (not the session) and the rest of the request uses the snapshot, so one request never retries Kite repeatedly.
- **Reconnect** reuses the Kite login flow; when a valid Kairo session is present, the new token is attached to it rather than creating a second session.

## Consequences
- Opening Kairo on a normal day needs no login. Reconnecting Kite is needed only to refresh quantities after trading.
- Snapshot values are end-of-day for stocks and NAV-dated for funds; intraday prices and positions need a live token. The UI labels which one you are seeing.
- Corporate actions after the snapshot (a bonus or split) change quantities the snapshot does not know about until the next reconnect.
- A stolen session cookie is now valid for up to 30 idle days instead of until 06:00. Mitigations: HttpOnly, Secure, SameSite=Lax, signed; only a hash stored; "sign out on all devices"; single allowed Kite user.
