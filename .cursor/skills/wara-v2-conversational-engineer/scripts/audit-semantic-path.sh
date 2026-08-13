#!/usr/bin/env bash
# Auditoría del path semántico unificado WARA V2.
# Estrictamente READ-ONLY: no modifica, formatea ni elimina archivos.
#
# Exit codes:
#   0 — sin violaciones en path unificado (pueden existir INFO en legacy/tests/parsers)
#   1 — una o más VIOLATION en path unificado (o atajo pre-LLM / decideTurn en unified)
#   2 — error de entorno (paths ausentes)
#
# INFO en tests, legacy apagado o parsers de campo NO equivale a PASS del unificado.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
PILOT="$ROOT/apps/wara-v2/src/pilot"
SEM="$PILOT/semantic"
OT="$PILOT/operational-turn.ts"

if [[ ! -d "$SEM" ]]; then
  echo "ERROR: no existe $SEM" >&2
  exit 2
fi

# Núcleo unificado: violaciones aquí cuentan para exit 1.
UNIFIED_CORE=(
  "$SEM/policy-engine.ts"
  "$SEM/conversation-reduce.ts"
  "$SEM/execute-decision.ts"
  "$SEM/turn-decision-schema.ts"
  "$SEM/interpret-turn.ts"
  "$SEM/interpret-turn-prompt.ts"
  "$SEM/response-plan.ts"
  "$SEM/brain-flags.ts"
)

PRECEDENCE="$SEM/turn-precedence.ts"

violations=0
infos=0

emit() {
  local kind="$1" scope="$2" file="$3" line="$4" pattern="$5"
  local rel="${file#"$ROOT"/}"
  printf '%s scope=%s file=%s line=%s pattern=%s\n' "$kind" "$scope" "$rel" "$line" "$pattern"
  if [[ "$kind" == "VIOLATION" ]]; then
    violations=$((violations + 1))
  else
    infos=$((infos + 1))
  fi
}

section() { printf '\n## %s\n' "$1"; }

is_comment_line() {
  [[ "$1" =~ ^[[:space:]]*// ]] || [[ "$1" =~ ^[[:space:]]*\* ]]
}

classify_scope() {
  local rel="$1"
  if [[ "$rel" == *".test.ts" || "$rel" == *".live.test.ts" || "$rel" == *"/tests/"* ]]; then
    echo "test"
    return
  fi
  if [[ "$rel" == *"/_diag-"* || "$rel" == *"/dist/"* ]]; then
    echo "diag_or_dist"
    return
  fi
  local f
  for f in "${UNIFIED_CORE[@]}"; do
    if [[ "$ROOT/$rel" == "$f" || "$rel" == "${f#"$ROOT"/}" ]]; then
      echo "unified"
      return
    fi
  done
  if [[ "$rel" == *"turn-precedence.ts" ]]; then
    echo "write_veto_helpers"
    return
  fi
  if [[ "$rel" == *"operational-turn.ts" ]]; then
    echo "orchestrator"
    return
  fi
  echo "other"
}

echo "=== WARA V2 semantic path audit (READ-ONLY) ==="
echo "root: $ROOT"
echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "note: VIOLATION=path unificado; INFO=legacy|test|parser|veto (no equivalentes)"

UNIFIED_START=0
UNIFIED_END=0
if [[ -f "$OT" ]]; then
  UNIFIED_START=$(grep -n "Cerebro semántico unificado" "$OT" | head -1 | cut -d: -f1 || echo 0)
  if [[ "$UNIFIED_START" -eq 0 ]]; then
    UNIFIED_START=$(grep -n "if (isUnifiedSemanticBrainEnabled(env))" "$OT" | head -1 | cut -d: -f1 || echo 0)
  fi
  UNIFIED_END=$(grep -n "beginSemanticTrace(text" "$OT" | head -1 | cut -d: -f1 || echo 0)
fi

# --- 1. looksLike* ---
section "1. looksLike*"
for f in "${UNIFIED_CORE[@]}"; do
  [[ -f "$f" ]] || continue
  while IFS= read -r gl; do
    local_line="${gl%%:*}"
    content="${gl#*:}"
    is_comment_line "$content" && continue
    [[ "$content" =~ looksLike ]] || continue
    emit "VIOLATION" "unified" "$f" "$local_line" "looksLike"
  done < <(grep -n "looksLike" "$f" 2>/dev/null || true)
done
if [[ -f "$OT" && "$UNIFIED_START" -gt 0 && "$UNIFIED_END" -gt "$UNIFIED_START" ]]; then
  echo "  orchestrator unified zone lines ${UNIFIED_START}-${UNIFIED_END}"
  while IFS= read -r gl; do
    ln="${gl%%:*}"
    content="${gl#*:}"
    is_comment_line "$content" && continue
    [[ "$content" =~ looksLike ]] || continue
    if [[ "$ln" -ge "$UNIFIED_START" && "$ln" -lt "$UNIFIED_END" ]]; then
      if [[ "$content" =~ !isUnifiedSemanticBrainEnabled ]]; then
        emit "INFO" "legacy_gated" "$OT" "$ln" "looksLike+!unified"
      else
        emit "VIOLATION" "unified" "$OT" "$ln" "looksLike"
      fi
    else
      emit "INFO" "legacy" "$OT" "$ln" "looksLike"
    fi
  done < <(grep -n "looksLike" "$OT" 2>/dev/null || true)
fi
if [[ -f "$PRECEDENCE" ]]; then
  while IFS= read -r gl; do
    ln="${gl%%:*}"; content="${gl#*:}"
    is_comment_line "$content" && continue
    [[ "$content" =~ looksLike ]] || continue
    emit "INFO" "write_veto_helpers" "$PRECEDENCE" "$ln" "looksLike"
  done < <(grep -n "looksLike" "$PRECEDENCE" 2>/dev/null || true)
fi
while IFS= read -r gl; do
  file="${gl%%:*}"
  rest="${gl#*:}"
  ln="${rest%%:*}"
  content="${rest#*:}"
  is_comment_line "$content" && continue
  emit "INFO" "test" "$file" "$ln" "looksLike"
done < <(grep -rn "looksLike" "$SEM" --include='*.test.ts' --include='*.live.test.ts' 2>/dev/null | head -40 || true)

# --- 2. includes|match|test sobre mensaje libre (intención) ---
section "2. includes|match|test sobre mensaje (policy/reduce/execute)"
for f in "$SEM/policy-engine.ts" "$SEM/conversation-reduce.ts" "$SEM/execute-decision.ts"; do
  [[ -f "$f" ]] || continue
  while IFS= read -r gl; do
    ln="${gl%%:*}"; content="${gl#*:}"
    is_comment_line "$content" && continue
    if [[ "$content" =~ (message|originalMessage|deps\.originalMessage)\.(includes|match)\( ]] ||
       [[ "$content" =~ \.test\((message|text|deps\.originalMessage|originalMessage) ]]; then
      if [[ "$content" =~ (fillExpected|expectedAnswerType|allowMessageAsUnitField|mustBlockWrite|structuredConfirm) ]]; then
        emit "INFO" "expected_field_or_veto" "$f" "$ln" "message-match"
      else
        emit "VIOLATION" "unified" "$f" "$ln" "message-match"
      fi
    fi
  done < <(grep -nE "includes\(|\.match\(|\.test\(" "$f" 2>/dev/null || true)
done

# --- 3. Regex: solo VIOLATION si actúa sobre texto libre del usuario ---
section "3. regex literales .test( en unified core"
for f in "${UNIFIED_CORE[@]}"; do
  [[ -f "$f" ]] || continue
  while IFS= read -r gl; do
    ln="${gl%%:*}"; content="${gl#*:}"
    is_comment_line "$content" && continue
    [[ "$content" =~ /[^/]+/[gimsuy]*\.test\( ]] || continue
    if [[ "$content" =~ \.test\((message|text|deps\.originalMessage|originalMessage|rawMessage) ]]; then
      if [[ "$content" =~ (fillExpected|expectedAnswerType|allowMessageAsUnitField|mustBlockWrite|isFarewell) ]]; then
        emit "INFO" "expected_field_or_veto" "$f" "$ln" "regex.test"
      else
        emit "VIOLATION" "unified" "$f" "$ln" "regex.test-on-user-text"
      fi
      continue
    fi
    # Formato ISO/hora, negatedAction estructurado, preguntas del agente, etc.
    emit "INFO" "field_or_structured" "$f" "$ln" "regex.test"
  done < <(grep -nE '/[^/]+/[gimsuy]*\.test\(' "$f" 2>/dev/null || true)
done

# --- 4. originalMessage / rawMessage ---
section "4. originalMessage|rawMessage en policy/reduce/execute"
for f in "$SEM/policy-engine.ts" "$SEM/conversation-reduce.ts" "$SEM/execute-decision.ts"; do
  [[ -f "$f" ]] || continue
  while IFS= read -r gl; do
    ln="${gl%%:*}"; content="${gl#*:}"
    is_comment_line "$content" && continue
    if [[ "$content" =~ (rawMessage|originalMessage|deps\.originalMessage) ]]; then
      if [[ "$content" =~ \.(includes|match)\( ]]; then
        if [[ "$content" =~ (fillExpected|expectedAnswerType|allowMessageAsUnitField|mustBlockWrite) ]]; then
          emit "INFO" "expected_field_or_veto" "$f" "$ln" "originalMessage"
        else
          emit "VIOLATION" "unified" "$f" "$ln" "originalMessage-as-router"
        fi
      elif [[ "$content" =~ (mustBlockWrite|allowMessageAsUnitField|fillExpected|ExecuteDeps|originalMessage:|structuredConfirm|answerDomainQuestion|handleGpsSideQuery|tryResolve|text: deps\.originalMessage|const msg = deps\.originalMessage) ]]; then
        emit "INFO" "expected_field_or_veto" "$f" "$ln" "originalMessage"
      else
        emit "INFO" "passthrough" "$f" "$ln" "originalMessage"
      fi
    fi
  done < <(grep -nE "rawMessage|originalMessage" "$f" 2>/dev/null || true)
done
if grep -nE "function reduceConversationState\([^)]*(message|text|raw)" "$SEM/conversation-reduce.ts" >/dev/null 2>&1; then
  ln=$(grep -nE "function reduceConversationState\(" "$SEM/conversation-reduce.ts" | head -1 | cut -d: -f1)
  emit "VIOLATION" "unified" "$SEM/conversation-reduce.ts" "$ln" "reducer-accepts-text"
fi

# --- 5. CONFIRMO sintético ---
section "5. CONFIRMO sintético"
while IFS= read -r gl; do
  file="${gl%%:*}"
  rest="${gl#*:}"
  ln="${rest%%:*}"
  content="${rest#*:}"
  is_comment_line "$content" && continue
  scope=$(classify_scope "${file#"$ROOT"/}")
  if [[ "$content" =~ (respondé|responde|Respondé|Si está correcto|turn\(\"CONFIRMO\"|turn\('CONFIRMO') ]]; then
    continue
  fi
  if [[ "$content" =~ CONFIRMO|confirmo ]] && [[ "$content" =~ (=|return|message:|text:) ]]; then
    if [[ "$scope" == "test" ]]; then
      emit "INFO" "test" "$file" "$ln" "CONFIRMO"
    elif [[ "$scope" == "unified" ]]; then
      emit "VIOLATION" "unified" "$file" "$ln" "synthetic-CONFIRMO"
    else
      if [[ "$file" == "$OT" && "$ln" -ge "$UNIFIED_START" && "$ln" -lt "$UNIFIED_END" ]]; then
        emit "VIOLATION" "unified" "$file" "$ln" "synthetic-CONFIRMO"
      else
        emit "INFO" "legacy" "$file" "$ln" "CONFIRMO"
      fi
    fi
  fi
done < <(grep -rnE "CONFIRMO|['\"]confirmo['\"]" "$SEM" "$OT" --include='*.ts' 2>/dev/null | head -100 || true)

# --- 6. Atajos pre-LLM en zona unified ---
section "6. atajos pre-LLM (zona unified operational-turn)"
if [[ "$UNIFIED_START" -gt 0 && "$UNIFIED_END" -gt "$UNIFIED_START" ]]; then
  echo "  unified zone lines ${UNIFIED_START}-${UNIFIED_END}"
  while IFS= read -r gl; do
    ln="${gl%%:*}"; content="${gl#*:}"
    [[ "$ln" -ge "$UNIFIED_START" && "$ln" -lt "$UNIFIED_END" ]] || continue
    is_comment_line "$content" && continue
    if [[ "$content" =~ looksLike ]]; then
      emit "VIOLATION" "unified" "$OT" "$ln" "pre-llm-looksLike"
    fi
  done < <(grep -n "looksLike" "$OT" 2>/dev/null || true)
else
  echo "  WARN: no se delimitó zona unified"
  violations=$((violations + 1))
fi

section "6b. company looksLike gates"
while IFS= read -r gl; do
  ln="${gl%%:*}"; content="${gl#*:}"
  if [[ "$ln" -ge "$UNIFIED_START" && "$ln" -lt "$UNIFIED_END" ]]; then
    emit "VIOLATION" "unified" "$OT" "$ln" "company-looksLike-in-unified"
  else
    if [[ "$content" =~ !isUnifiedSemanticBrainEnabled ]]; then
      emit "INFO" "legacy_gated" "$OT" "$ln" "company-looksLike"
    else
      emit "INFO" "legacy" "$OT" "$ln" "company-looksLike"
    fi
  fi
done < <(grep -n "looksLikeCompanySelection\|looksLikeChangeCompanyRequest" "$OT" 2>/dev/null || true)

# --- 7. Write flags true ---
section "7. flags de escritura = true"
while IFS= read -r gl; do
  file="${gl%%:*}"
  rest="${gl#*:}"
  ln="${rest%%:*}"
  content="${rest#*:}"
  rel="${file#"$ROOT"/}"
  scope=$(classify_scope "$rel")
  if [[ "$scope" == "test" || "$scope" == "diag_or_dist" ]]; then
    emit "INFO" "$scope" "$file" "$ln" "write-flag-true"
  elif [[ "$content" =~ (salvo|unless|bloquead|Solo invocable|si .*true) ]]; then
    emit "INFO" "doc_comment" "$file" "$ln" "write-flag-mention"
  else
    emit "VIOLATION" "unified" "$file" "$ln" "write-flag-true"
  fi
done < <(grep -rnE "WARA_V2_(ODOMETER|CERTIFICATE|ODOO)_WRITE_ENABLED\s*[:=]\s*[\"']?true|ALLOW_EXTERNAL_MUTATIONS\s*[:=]\s*[\"']?true" \
  "$ROOT/apps/wara-v2/src" --include='*.ts' 2>/dev/null | head -50 || true)

# --- 8. Legacy decideTurn ---
section "8. legacy decideTurn / imports"
if [[ -f "$OT" ]]; then
  if grep -n "interpretTurn" "$OT" >/dev/null; then
    echo "  INFO interpretTurn presente (esperado en orchestrator)"
  fi
  while IFS= read -r gl; do
    ln="${gl%%:*}"; content="${gl#*:}"
    if [[ "$ln" -ge "$UNIFIED_START" && "$ln" -lt "$UNIFIED_END" ]]; then
      emit "VIOLATION" "unified" "$OT" "$ln" "decideTurn-in-unified"
    else
      emit "INFO" "legacy" "$OT" "$ln" "decideTurn"
    fi
  done < <(grep -nE "decideTurn\(" "$OT" 2>/dev/null || true)
fi

echo
echo "=== SUMMARY ==="
echo "violations=$violations infos=$infos"
echo "READ-ONLY: no files modified."
if [[ "$violations" -gt 0 ]]; then
  echo "RESULT=FAIL (unified violations present)"
  exit 1
fi
echo "RESULT=PASS (no unified violations; infos are non-blocking)"
exit 0
