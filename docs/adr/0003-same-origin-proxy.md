# 3. Same-origin API through a Next.js rewrite

**Status:** accepted

## Context
The API holds the session. The web app needs to call it with cookies.

## Decision
The browser calls `/api/*` on the web origin; Next.js rewrites to the API. The API is not exposed publicly in Docker Compose.

## Consequences
- First-party `SameSite=Lax` cookies, no CORS config, no tokens in JavaScript.
- One public surface to put TLS and rate limiting on.
- The web server is on the request path for every API call. Fine at one user.
