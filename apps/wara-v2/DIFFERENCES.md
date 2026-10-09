# Diferencias WARA V2 vs documentación 0.2.3

## Fase 8 (cierre)

- Snapshot oficial: `gpt-4o-mini-2024-07-18`
- Alias `gpt-4o-mini` solo con `WARA_V2_LLM_ALLOW_ALIAS=true` (no oficial)
- Structured Outputs: `response_format.type=json_schema` + `strict=true` + `LlmProposal`
- Benchmark oficial: `pnpm --filter @wara-v2/app llm:benchmark-official`

## Fase 9A (añadido)

- Pipeline de gobernanza sintético: dropbox → cuarentena → deid → scan → approve → partitions
- 9B bloqueada sin `HISTORICAL_AUTH.json`
- Evaluation-only incompatible con delivery/mutaciones/canales
- Datos solo bajo `apps/wara-v2/.local-data/governance/` (gitignored)

## Fuera de alcance

- 9B histórica, Fase 10, canales reales, WARA/BBC/WhatsApp, push, producción
