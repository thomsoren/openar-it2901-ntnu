# Auth + JWT Setup (Local Development)

## 1. Start PostgreSQL

```bash
docker compose -f infra/docker-compose.postgres.yml up -d
docker compose -f infra/docker-compose.postgres.yml ps
```

Database credentials used in this sprint:

- User: `openar`
- Password: `openar_dev`
- Database: `openar`
- Host/port: `localhost:5433`

## 2. Configure environment files

### `auth-service/.env`

Copy `auth-service/.env.example` and set at minimum:

- `DATABASE_URL=postgresql://openar:openar_dev@localhost:5433/openar`
- `BETTER_AUTH_SECRET=<strong-random-secret>`
- `BETTER_AUTH_URL=http://localhost:3001`
- `BETTER_AUTH_BASE_PATH=/api/auth`
- `CORS_ORIGIN=http://localhost:5173`

### `backend/.env`

Copy `backend/.env.example` and set at minimum:

- `DATABASE_URL=postgresql+psycopg://openar:openar_dev@localhost:5433/openar`
- `JWT_SECRET_KEY=<strong-random-secret>`
- `JWT_ACCESS_TTL_MIN=15`
- `BETTER_AUTH_BASE_URL=http://localhost:3001`
- `BETTER_AUTH_BASE_PATH=/api/auth`

### `frontend/.env`

Copy `frontend/.env.example` and set at minimum:

- `VITE_API_URL=http://localhost:8000`
- `VITE_BETTER_AUTH_URL=http://localhost:3001`
- `VITE_BETTER_AUTH_BASE_PATH=/api/auth`

## 3. Install dependencies

```bash
pnpm run install
```

This installs frontend and auth-service dependencies, and syncs backend (`uv`).

## 4. Run services

Run everything from repo root:

```bash
pnpm run dev
```

This starts:

- FastAPI backend (`:8000`)
- React frontend (`:5173`)
- Better Auth service (`:3001`)

## 5. Optional SQL check

```bash
docker exec -it openar-postgres psql -U openar -d openar
```

Inside `psql`, verify backend user table:

```sql
\dt
SELECT * FROM app_users;
```

## Notes

- Better Auth tables are auto-migrated by `auth-service` on startup.
- `app_users` is backend-owned authorization data (`is_admin`, `username`), and can also be created from `backend/migrations/001_create_app_users.sql`.
- For existing DBs created before username-only auth, also apply `backend/migrations/002_username_only_app_users.sql`.
- Backend APIs now require `Authorization: Bearer <JWT>` (or `access_token` query for media/WebSocket/SSE).
