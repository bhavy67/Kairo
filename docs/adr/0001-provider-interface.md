# 1. Broker access behind a provider interface

**Status:** accepted

## Context
Kite is the only broker today. The app also needs a demo mode for a public repo, and tests that never touch the network.

## Decision
Routes depend on `PortfolioProvider`. Vendor payloads are mapped into `@kairo/core` types inside the provider and nowhere else.

## Consequences
- Demo mode and tests are just other providers.
- Kite field changes are contained in one mapper and one schema file.
- One extra layer of mapping code, which is small.
