# 7. Store daily indicators; evaluate screen rules in TypeScript

**Status:** accepted

## Context
The market overview, screeners and alerts all need the same per-stock numbers: SMAs, RSI, returns, 52-week range, volume ratio. Computing them is a ~135k-row window query (~6 s on Supabase's free tier). On serverless there is no warm in-memory cache to hide that.

Users also build their own screens, and those rules come from the browser.

## Decision
- Compute indicators once per trading day after import and store them (`indicators`, one row per stock per day). The overview snapshot (`market_snapshots`) is derived from them.
- Screens are a small JSON rule language (AND of conditions; numeric field vs value, field vs field, or event flag). The API validates rules against a closed whitelist with Zod, loads the day's ~500 indicator rows, and evaluates the rule in TypeScript (`runScreen` in core).

## Consequences
- Reads are cheap: a screen is one indexed query plus an in-memory filter.
- User input never becomes SQL, so there is no injection surface and no need for a query builder.
- The same pure function runs presets, saved screens, alert screens and tests.
- It scales to the Nifty 500, not to "every listed stock × many users". Past that, translate rules to SQL `where` clauses over the same whitelist.
- Alerts fire when a condition *becomes* true (crossing days, new screen entrants). Events are unique per source/day/symbol and delivery marks rows as sent, so retried cron runs neither duplicate events nor re-send messages.
