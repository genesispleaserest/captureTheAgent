# ROMA Review Runbook

This document explains how to build and run the Arena monorepo for review.

## Prerequisites

- Node.js 18+
- PNPM 8
- Optional: Docker 24+

## Local (PNPM)

1. Install dependencies at the repo root:
   - `pnpm install`
2. Start the Referee API (Express/TypeScript):
   - `pnpm --filter @arena/referee dev`
   - API runs on `http://localhost:8080`
3. In a separate terminal, start the Web UI (Next.js 14):
   - PowerShell: `./scripts/start-web-with-api.ps1 -ApiUrl "http://localhost:8080"`
   - Or set env and run: `set NEXT_PUBLIC_REFEREE_URL=http://localhost:8080 && pnpm --filter @arena/web dev`

Notes:
- The API uses SQLite by default. Set `ARENA_DB_PATH` to a persistent location for durability.
- CORS is locked down in production via `ARENA_ALLOWED_ORIGINS`. For local dev, the default allows `http://localhost:3000`.

## Docker Compose

1. Build and start both services:
   - `docker compose up --build`
2. Services:
   - API: http://localhost:8080 (persists DB under a named volume `arena_data`)
   - Web: http://localhost:3000

Environment variables used by containers:
- `ARENA_DB_PATH=/data/arena.db` (volume mounted at `/data`)
- `ARENA_ALLOWED_ORIGINS=http://localhost:3000`
- `NEXT_PUBLIC_REFEREE_URL=http://localhost:8080`

## Health and Limits

- Liveness: `GET /live` → `{ status: "ok" }`
- Readiness: `GET /ready` → `{ status: "ok" }` when the DB is reachable
- Back-compat: `GET /health` redirects to `/ready`
- Body size: configurable via `ARENA_JSON_LIMIT` (default `1mb`).
- Rate limiting: in-memory limit per IP with `ARENA_RATE_LIMIT_WINDOW_MS` and `ARENA_RATE_LIMIT_MAX`.
  - Stricter per-route: `ARENA_RATE_LIMIT_CLAIMS_*`, `ARENA_RATE_LIMIT_SESSIONS_*`.

## CI

GitHub Actions workflow builds and tests with PNPM across the monorepo. See `.github/workflows/ci.yml`.

## Kubernetes (optional)

Minimal manifests are under `deploy/k8s`. Replace image references with your registry.
