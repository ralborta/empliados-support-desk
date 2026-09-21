#!/usr/bin/env bash
# Auditoría READ-ONLY del path Commander V3.
# Falla si encuentra looksLike*, routing regex de intención, CONFIRMO sintético,
# includes de semántica, o imports del conductor V2.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
V3="$ROOT/apps/wara-v2/src/commander-v3"
violations=0

echo "=== AUDIT commander-v3 ==="
echo "ROOT=$ROOT"
echo "V3=$V3"

if [[ ! -d "$V3" ]]; then
  echo "ERROR: missing $V3"
  exit 2
fi

check() {
  local label="$1"
  local pattern="$2"
  local hits
  hits=$(rg -n --glob '!**/tests/**' --glob '!**/*.test.ts' -e "$pattern" "$V3" || true)
  if [[ -n "$hits" ]]; then
    echo "VIOLATION scope=v3 label=$label"
    echo "$hits" | while read -r line; do echo "  $line"; done
    violations=$((violations + 1))
  else
    echo "OK $label"
  fi
}

check "looksLike" 'looksLike[A-Za-z]+'
check "import_interpretTurn" 'interpret-turn|interpretTurn'
check "import_policy_engine" 'policy-engine'
check "import_conversation_reduce" 'conversation-reduce'
check "import_execute_decision" 'execute-decision'
check "import_turn_precedence" 'turn-precedence'

# CONFIRMO sintético: generar confirmación en código (no el texto que pide al usuario responder CONFIRMO)
synth=$(rg -n --glob '!**/tests/**' -e 'answer\s*[:=]\s*["'\'']confirm["'\'']|CONFIRMO\s*sintético|synthetic.*CONFIRMO' "$V3" || true)
if [[ -n "$synth" ]]; then
  echo "VIOLATION scope=v3 label=CONFIRMO_synthetic"
  echo "$synth"
  violations=$((violations + 1))
else
  echo "OK CONFIRMO_synthetic"
fi

# Soft INFO: originalMessage usage (allowed only outside entity resolver)
info_hits=$(rg -n 'originalMessage' "$V3" || true)
if [[ -n "$info_hits" ]]; then
  echo "INFO originalMessage references (review entity resolver must not use message):"
  echo "$info_hits" | head -20
fi

echo "=== SUMMARY violations=$violations ==="
if [[ "$violations" -gt 0 ]]; then
  exit 1
fi
exit 0
