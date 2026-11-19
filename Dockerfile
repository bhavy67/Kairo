# One image, two targets: `--target api` and `--target web`.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
# Docker serves /api through the standalone API container (see next.config.ts).
ENV API_URL=http://api:4000
RUN pnpm build && pnpm deploy --filter @kairo/api --prod --legacy /out/api

FROM node:22-alpine AS api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000
WORKDIR /app
COPY --from=build /out/api ./
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]

FROM node:22-alpine AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
