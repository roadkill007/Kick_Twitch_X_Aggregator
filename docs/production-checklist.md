# Production Launch Checklist

## Required infrastructure

- Permanent API domain configured in `APP_PUBLIC_URL`.
- Permanent web domain configured in `WEB_PUBLIC_URL` and `NEXT_PUBLIC_API_BASE_URL`.
- Managed PostgreSQL with backups enabled.
- Managed Redis with persistence enabled.
- HTTPS termination in front of web and API services.
- Twitch app callback exactly matches `TWITCH_REDIRECT_URI`.

## Required secrets

- `JWT_SECRET` generated with at least 32 random characters.
- `DATABASE_URL` stored only in deployment secrets.
- `REDIS_URL` stored only in deployment secrets.
- `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` stored only in deployment secrets.

## Verification before public launch

```bash
pnpm test
pnpm typecheck
pnpm build
```

Runtime checks:

- `GET /health/live` returns `{"status":"ok"}`.
- `GET /health/ready` reports PostgreSQL and Redis as `ok`.
- Twitch OAuth start/callback works with the production callback URL.
- Kick channel resolution works for at least one public channel.
- X broadcast bootstrap works for a public broadcast URL.
- OBS overlay URL connects and displays a synthetic or real chat message.

## Security controls included

- Helmet security headers on API responses.
- API-wide rate limit baseline.
- JWT-authenticated dashboard APIs.
- Hash-only overlay token persistence.
- Provider status endpoints avoid returning provider secrets/tokens.
- Production env template avoids committing real credentials.

## Operational notes

- Rotate overlay URLs if they are shared accidentally.
- Rotate Twitch credentials if they are exposed.
- Keep the API and web images pinned to the same git commit.
- Review provider platform terms before public launch at scale.
