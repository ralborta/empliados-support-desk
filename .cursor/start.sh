#!/usr/bin/env bash
# Cloud Agent start phase: per-boot runtime initialization.
# Starts PostgreSQL, ensures the dev database/role exist, writes a local .env
# with dev-only dummy values, and applies Prisma migrations. Idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."

PG_DB="empliados"
PG_USER="empliados"
PG_PASS="empliados_local_dev"

# --- Start PostgreSQL (idempotent) ---
sudo pg_ctlcluster 16 main start 2>/dev/null || true
echo "[start] Waiting for PostgreSQL..."
for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
sudo -u postgres pg_isready

# --- Ensure role + database exist (idempotent) ---
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${PG_USER}'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE USER ${PG_USER} WITH PASSWORD '${PG_PASS}';"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE ${PG_DB} OWNER ${PG_USER};"

# --- Local .env (dev-only dummy values; NOT real secrets) ---
if [ ! -f .env ]; then
  echo "[start] Writing dev .env"
  cat > .env <<'ENV'
# Auto-generated for Cloud Agent dev. NOT for production.
DATABASE_URL="postgresql://empliados:empliados_local_dev@localhost:5432/empliados?schema=public"
SESSION_PASSWORD="empliados-session-secret-key-32-chars-minimum-required-for-security"
PANEL_USER_ADMIN_EMAIL="admin@empliados.local"
PANEL_USER_ADMIN_PASSWORD="admin-local-dev-2025"
PANEL_USER_WARA_EMAIL="wara@empliados.local"
PANEL_USER_WARA_PASSWORD="wara-local-dev-2025"
WARA_INBOUND_AUDIT_ONLY=true
ENV
fi

# --- Apply Prisma migrations (idempotent) ---
echo "[start] Applying Prisma migrations..."
corepack pnpm exec prisma migrate deploy

echo "[start] Ready."
