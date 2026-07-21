#!/usr/bin/env bash
# Estado actual para rollback — solo lectura, no modifica nada.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Rollback status — empliados-support-desk ==="
echo ""
echo "Git (local):"
git log -1 --format="  HEAD: %h %s (%ci)"
echo "  Branch: $(git branch --show-current)"
if git rev-parse '@{u}' >/dev/null 2>&1; then
  ahead="$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)"
  behind="$(git rev-list --count 'HEAD..@{u}' 2>/dev/null || echo 0)"
  echo "  vs origin: ahead=$ahead behind=$behind"
fi

echo ""
echo "Commits Fase 0 (revert Nivel 2):"
echo "  3af337f — fix cierre Fase 0 vía Odoo"
echo "  8f5db70 — Fase 0 audit-only inbound"

echo ""
echo "Producción (HTTP):"
code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 https://wara.nivel41.com/ 2>/dev/null || echo 'ERR')"
echo "  https://wara.nivel41.com/ → HTTP $code"

echo ""
echo "Variable Vercel (no readable desde aquí):"
echo "  WARA_INBOUND_AUDIT_ONLY=true   → Fase 0 ON (default si ausente)"
echo "  WARA_INBOUND_AUDIT_ONLY=false  → rollback Nivel 1 (inbound habla al cliente)"
echo ""
echo "Guía completa: $ROOT/ROLLBACK.md"
echo ""
echo "Rollback rápido Nivel 1: editar variable en Vercel y Redeploy."
echo "Rollback Nivel 2: git revert 3af337f 8f5db70 && git push origin main"
