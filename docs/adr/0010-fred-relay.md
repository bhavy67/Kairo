# 10. Fetch FRED through a Supabase Edge Function relay

**Status:** accepted

## Context
Global series come from FRED's keyless CSV endpoint. It answers in under half a second from most networks, but requests from Vercel's Mumbai region (where the API runs, next to NSE and the database) time out: FRED drops connections from some cloud ranges. A probe deployed as a Supabase Edge Function reached FRED in 77–291 ms.

## Options
| Option | Cost | Downside |
|---|---|---|
| Move the API to a US region | none | NSE downloads and every database query cross the planet |
| FRED's keyed API | a key | likely the same network block; another secret |
| Run the global job on GitHub Actions | none | a database credential in a second system |
| **Relay only the FRED call through an Edge Function** | none | one more small deployable |

## Decision
A Supabase Edge Function (`infra/supabase/functions/fred-relay`) fetches one FRED series and returns the CSV. The job uses it when `FRED_RELAY_URL` and `FRED_RELAY_TOKEN` are set, and calls FRED directly otherwise (local development, Docker).

The relay is not an open proxy: it serves only the six series Kairo uses, validates the start date, and requires a token. The function source holds only the token's SHA-256, so the code can be public; the token lives in Vercel's sensitive env vars.

## Consequences
- Everything else (parsing, storage, scheduling, failure isolation) is unchanged and tested with and without the relay.
- If FRED starts blocking Supabase's network too, the job reports those series as failed while currency rates still update; the page shows each series' own date.
- Rotating the token: generate a new one, put its SHA-256 in the function, redeploy it, update `FRED_RELAY_TOKEN`.
