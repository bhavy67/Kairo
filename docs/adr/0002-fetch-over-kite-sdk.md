# 2. Call Kite REST with fetch, not the official SDK

**Status:** accepted

## Context
Phase 1 uses five endpoints. The official `kiteconnect` package returns untyped objects and its own error shapes.

## Decision
A ~100-line client over `fetch`, with Zod schemas for each response and Kite errors mapped to `SessionExpiredError` / `UpstreamError`.

## Consequences
- Every field the UI uses is validated at the boundary.
- `fetch` is injectable, so the whole OAuth flow is tested end to end without the network.
- WebSocket ticks (Phase 2) will need more code. Reconsider the SDK's ticker then.
