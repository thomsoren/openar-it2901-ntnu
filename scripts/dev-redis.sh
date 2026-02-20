#!/bin/sh

set -eu

if command -v redis-server >/dev/null 2>&1; then
  echo "[dev:redis] starting redis-server on 127.0.0.1:6379"
  exec redis-server --port 6379 --save "" --appendonly no
fi

echo "[dev:redis] redis-server not found."
echo "[dev:redis] install once with: brew install redis"
echo "[dev:redis] then rerun: pnpm dev"
exit 1
