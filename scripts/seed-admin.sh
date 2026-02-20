#!/bin/sh
# Creates a default admin user for local development.
# Requires: auth-service running on :3001, PostgreSQL running on :5433
#
# Default credentials:  test / 12341234

set -eu

AUTH_URL="${BETTER_AUTH_URL:-http://localhost:3001}"
AUTH_PATH="${BETTER_AUTH_BASE_PATH:-/api/auth}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"
DB_USER="${DB_USER:-openar}"
DB_NAME="${DB_NAME:-openar}"

SEED_USERNAME="test"
SEED_EMAIL="test@openar.local"
SEED_PASSWORD="12341234"

SIGNUP_URL="${AUTH_URL}${AUTH_PATH}/sign-up/email"

echo "[seed-admin] registering dev user '${SEED_USERNAME}' via ${SIGNUP_URL} ..."

# Try to register. 200 = created, 4xx = likely already exists — both are fine.
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${SIGNUP_URL}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${SEED_EMAIL}\",\"password\":\"${SEED_PASSWORD}\",\"name\":\"${SEED_USERNAME}\",\"username\":\"${SEED_USERNAME}\"}")

if [ "$HTTP_CODE" = "200" ]; then
  echo "[seed-admin] user created in auth-service"
elif [ "$HTTP_CODE" = "000" ]; then
  echo "[seed-admin] ERROR: could not reach auth-service at ${SIGNUP_URL}"
  echo "[seed-admin] make sure auth-service is running (pnpm run dev:auth)"
  exit 1
else
  echo "[seed-admin] user may already exist (HTTP ${HTTP_CODE}) — continuing"
fi

# Fetch the user ID from Better Auth so we can sync it to app_users
SESSION_URL="${AUTH_URL}${AUTH_PATH}/sign-in/email"
RESPONSE=$(curl -s -X POST "${SESSION_URL}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${SEED_EMAIL}\",\"password\":\"${SEED_PASSWORD}\"}")

USER_ID=$(echo "$RESPONSE" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)

if [ -z "$USER_ID" ]; then
  echo "[seed-admin] ERROR: could not extract user ID from sign-in response"
  echo "[seed-admin] response: ${RESPONSE}"
  exit 1
fi

echo "[seed-admin] user ID: ${USER_ID}"

# Upsert into app_users and set is_admin = true
SQL="INSERT INTO app_users (id, username, email, is_admin)
VALUES ('${USER_ID}', '${SEED_USERNAME}', '${SEED_EMAIL}', true)
ON CONFLICT (id) DO UPDATE SET is_admin = true;"

docker exec openar-postgres psql -U "${DB_USER}" -d "${DB_NAME}" -c "${SQL}" > /dev/null 2>&1

echo "[seed-admin] admin user ready"
echo ""
echo "  username : ${SEED_USERNAME}"
echo "  email    : ${SEED_EMAIL}"
echo "  password : ${SEED_PASSWORD}"
echo "  admin    : true"
echo ""
