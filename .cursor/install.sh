#!/usr/bin/env bash
# Cloud Agent install phase: idempotent dependency bootstrap.
set -euo pipefail
cd "$(dirname "$0")/.."

# --- System dependency: PostgreSQL 16 (idempotent) ---
# The main app uses Prisma against PostgreSQL. Install it if the base image
# does not already provide it (a snapshot-based build will skip this).
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  echo "[install] Installing PostgreSQL 16..."
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib
fi

# --- Node dependencies ---
# packageManager in package.json pins pnpm 10.33.3 (matches pnpm-lock.yaml).
# postinstall runs `prisma generate`.
corepack enable
corepack pnpm install --frozen-lockfile
