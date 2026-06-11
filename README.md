# Unified Stream Chat Aggregator

Public multi-platform livestream chat aggregator for **Shared Chat Sessions**. The platform lets creators connect Twitch, Kick, and X livestream chat sources into one unified real-time feed and expose that feed through hosted OBS/Streamlabs browser-source overlays.

## Level status

- **Level 1 — Foundation:** complete
  - Auth, profiles, Shared Chat Sessions, collaborators, PostgreSQL, Redis, health, metrics, audit logs, WebSocket base.
- **Level 2 — Internal chat pipeline:** complete
  - Provider interface, event bus, queue, router, normalization, feed manager, internal simulation tests.
- **Level 3 — Real provider integrations:** complete
  - Twitch OAuth/EventSub primitives, Kick Pusher chat provider, X broadcast chat bootstrap/history/WebSocket, provider lifecycle routes.
- **Level 4 — Product UI:** complete
  - Dashboard for register/login, Shared Chat Session creation, platform connection setup, provider controls.
- **Level 5 — Browser-source overlays:** complete
  - Overlay token generation, read-only overlay WebSocket, hosted `/overlay/[sessionId]` page for OBS/Streamlabs.
- **Level 6 — Production readiness:** complete
  - Security headers, rate limiting, production compose, Dockerfiles, CI workflow, env template, launch checklist.

## Local development

```bash
corepack enable
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Start dependencies:

```bash
docker compose up -d postgres redis
```

Start API:

```bash
# Put DATABASE_URL, REDIS_URL, JWT_SECRET, APP_PUBLIC_URL, and Twitch credentials in .env.
pnpm --filter @sca/api exec tsx src/index.ts
```


Start web:

```bash
NEXT_PUBLIC_API_BASE_URL="http://localhost:3001" pnpm --filter @sca/web dev
```

## Production baseline

Copy `.env.example` to `.env`, fill real values, then:

```bash
docker compose -f docker-compose.production.yml up -d --build
```

Required production values:

- `APP_PUBLIC_URL` — public API URL used for Twitch callback and generated links.
- `WEB_PUBLIC_URL` — public web app URL.
- `NEXT_PUBLIC_API_BASE_URL` — browser-facing API base URL baked into the web build.
- `DATABASE_URL` — production PostgreSQL connection string.
- `REDIS_URL` — production Redis URL.
- `JWT_SECRET` — at least 32 random characters.
- `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` — Twitch application credentials.
- `TWITCH_REDIRECT_URI` — must match the Twitch developer console callback.

## Main API flows

- Register/login:
  - `POST /api/v1/auth/register`
  - `POST /api/v1/auth/login`
- Shared Chat Sessions:
  - `POST /api/v1/shared-sessions`
  - `GET /api/v1/shared-sessions`
- Platform setup:
  - `GET /api/v1/connections/twitch/start`
  - `GET /api/v1/connections/twitch/callback`
  - `POST /api/v1/connections/kick/resolve`
  - `POST /api/v1/connections/x/resolve`
- Provider lifecycle:
  - `POST /api/v1/shared-sessions/:sessionId/providers/twitch/start`
  - `POST /api/v1/shared-sessions/:sessionId/providers/kick/start`
  - `POST /api/v1/shared-sessions/:sessionId/providers/x/start`
  - `POST /api/v1/shared-sessions/:sessionId/providers/:platform/stop`
- Overlay:
  - `POST /api/v1/shared-sessions/:sessionId/overlay-token`
  - `GET /api/v1/overlay/ws?sessionId=...&token=...`
  - Web route: `/overlay/[sessionId]?token=...`

## Verification

Current quality gates:

```bash
pnpm test
pnpm typecheck
pnpm build
```

CI runs these same gates on pushes and pull requests to `main`.
