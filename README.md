# Red‑Team Arena (Capture‑the‑Agent)

[![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/ci.yml)

A competitive platform for hardening AI safety and tool security through live challenges and attack simulation.

## Monorepo Overview

This is a PNPM/Turbo monorepo with three primary packages:

- `services/referee` — TypeScript/Express API for sessions, claims, and leaderboard (SQLite by default)
- `services/web` — Next.js 14 UI (standalone output enabled)
- `packages/arena-core` — Shared types and helpers used across services

## Prerequisites

- Node.js 18+ (LTS recommended)
- PNPM 8 (root declares `packageManager: pnpm@8.0.0`)

Optional (for Docker-based deploys):
- Docker 24+

## Quick Start (Dev)

1. Install deps at the repo root:
   - `pnpm install`
2. Start the API (Referee) in watch mode:
   - `pnpm --filter @arena/referee dev`
3. Start the Web UI in dev mode (pointing at the API):
   - PowerShell helper: `./scripts/start-web-with-api.ps1 -ApiUrl "http://localhost:8080"`
   - Or set env and run: `set NEXT_PUBLIC_REFEREE_URL=http://localhost:8080 && pnpm --filter @arena/web dev`

Default ports:
- Referee API: `http://localhost:8080`
- Web UI: `http://localhost:3000`

## Environment Variables

Copy and edit `env.example` as needed. Key vars:

- `ARENA_DB_PATH` — SQLite DB path for the Referee (default `arena.db`)
- `ARENA_ALLOWED_ORIGINS` — Comma-separated allowed origins for CORS in production
- `ARENA_JSON_LIMIT` — Max JSON payload size for API requests (e.g., `1mb`)
- `NEXT_PUBLIC_REFEREE_URL` — Web UI environment var pointing to the Referee API

## Build and Test

- Build all packages: `pnpm build`
- Run tests: `pnpm test`

Turbo is configured to cache builds and run tasks across the workspace.

## Production

- Web uses Next.js `output: 'standalone'` for lean runtime images.
- The Referee persists to SQLite by default; for multi-instance deployments, back it with persistent storage (or adapt to a managed DB) and set `ARENA_DB_PATH` accordingly.
- CORS is restricted in production via `ARENA_ALLOWED_ORIGINS`.

### Health Endpoints

- `GET /live` — liveness (always OK)
- `GET /ready` — readiness (DB check)
- `GET /health` — 307 redirect to `/ready`

### Request IDs and Logging

- Every request includes/returns `x-request-id`. If the header is not provided, the API generates one.
- Access logs are emitted as JSON lines with request metadata and duration.

### Rate Limits

- Global per‑IP limit: `ARENA_RATE_LIMIT_WINDOW_MS` and `ARENA_RATE_LIMIT_MAX`.
- Stricter per‑route limits:
  - `/claims`: `ARENA_RATE_LIMIT_CLAIMS_WINDOW_MS`, `ARENA_RATE_LIMIT_CLAIMS_MAX`
  - `/sessions`: `ARENA_RATE_LIMIT_SESSIONS_WINDOW_MS`, `ARENA_RATE_LIMIT_SESSIONS_MAX`

### Docker (optional)

This repo includes minimal Dockerfiles for the API and Web, plus a `docker-compose.yml` for local orchestration. See inline comments in those files for details.

## Contributing

This is a security-focused project. Please follow responsible disclosure practices and refer to our security policy for reporting vulnerabilities.

## License

MIT License - see LICENSE file for details.

