# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app

# Use corepack to enable pnpm in Node 20 images
RUN corepack enable

# --- Build monorepo (referee + arena-core) ---
FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY packages ./packages
COPY services/referee ./services/referee
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @arena/core build && pnpm --filter @arena/referee build

# --- Runtime image ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Only copy runtime files for referee
COPY --from=build /app/services/referee/dist ./dist
COPY --from=build /app/services/referee/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules

# SQLite DB path (override via ARENA_DB_PATH and mount a volume)
ENV ARENA_DB_PATH=/data/arena.db
VOLUME ["/data"]

EXPOSE 8080
CMD ["node", "dist/server.js"]

