# Unified Stream Chat Aggregator

Public web platform for Shared Chat Sessions that will eventually aggregate Twitch, Kick, and X livestream chat into a hosted browser-source overlay.

## Current Scope: Level 1 Foundation Only

This repository is intentionally limited to the structural foundation:

- User authentication
- Accounts and profiles
- Shared Chat Sessions
- Collaborator invitations and permissions
- PostgreSQL schema and migrations
- Redis connectivity
- REST API and WebSocket infrastructure
- Configuration validation
- Structured logging and audit logs
- Health, metrics, graceful shutdown, API versioning

## Explicitly Not Implemented Yet

- Twitch, Kick, or X providers
- Mock providers
- Internal message pipeline
- Chat overlays
- OBS/Streamlabs browser sources
- Overlay customization
- Moderation

## Development

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm test
```

Level progression must remain sequential. Do not implement Level 2+ features until Level 1 completion criteria pass.
