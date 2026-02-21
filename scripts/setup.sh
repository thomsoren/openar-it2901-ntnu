#!/bin/sh
# First-time project setup for local development.
# Safe to re-run — skips steps that are already done.

set -eu

echo ""
echo "========================================="
echo "  OpenAR — Local Development Setup"
echo "========================================="
echo ""

# ── 1. Copy .env files (skip if they already exist) ───────────────
for dir in frontend backend auth-service; do
  if [ ! -f "$dir/.env" ]; then
    if [ -f "$dir/.env.example" ]; then
      cp "$dir/.env.example" "$dir/.env"
      echo "[setup] created $dir/.env from .env.example"
    else
      echo "[setup] WARNING: $dir/.env.example not found"
    fi
  else
    echo "[setup] $dir/.env already exists — skipping"
  fi
done

# ── 2. Start infrastructure (PostgreSQL + Redis) ─────────────────
echo ""
echo "[setup] starting PostgreSQL + Redis via Docker..."
docker compose -f infra/docker-compose.postgres.yml up -d

# ── 3. Install dependencies ──────────────────────────────────────
echo ""
echo "[setup] installing dependencies..."
pnpm run install

# ── 4. Wait for PostgreSQL to be ready ───────────────────────────
echo ""
echo "[setup] waiting for PostgreSQL to accept connections..."
for i in 1 2 3 4 5 6 7 8 9 10; do
  if docker exec openar-postgres pg_isready -U openar > /dev/null 2>&1; then
    echo "[setup] PostgreSQL is ready"
    break
  fi
  if [ "$i" = "10" ]; then
    echo "[setup] WARNING: PostgreSQL not ready after 10s — it may still be starting"
  fi
  sleep 1
done

echo ""
echo "========================================="
echo "  Setup complete!"
echo "========================================="
echo ""
echo "  Next steps:"
echo ""
echo "  1. Start all services:"
echo "     pnpm dev"
echo ""
echo "  2. In another terminal, create a dev admin user:"
echo "     pnpm seed-admin"
echo ""
echo "  3. Log in at http://localhost:5173"
echo "     Email:    test@openar.local"
echo "     Password: 12341234"
echo ""
