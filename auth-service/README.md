# OpenAR Auth Service

Better Auth runtime for local username/email + password authentication.

## Environment

Copy `.env.example` to `.env` and set:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_BASE_PATH`
- `CORS_ORIGIN`

## Run

```bash
cd auth-service
pnpm install
pnpm dev
```

The service starts on `http://localhost:3001` by default and mounts Better Auth routes at `/api/auth`.

It auto-runs Better Auth migrations on startup.
