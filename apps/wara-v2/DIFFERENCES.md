# Diferencias WARA V2 vs documentación 0.2.3

## Fase 6–7 (previas)

- Runtime E2E, DeliveryGate, attempt canónico, API loopback shadow/replay.
- Matriz 30/30 Fase 6 + auth fake.

## Fase 8 (añadido)

- Puerto LLM + contrato `LlmProposal` v1.
- Único adaptador real: OpenAI `gpt-4o-mini` vía `https://api.openai.com/v1/chat/completions` (sin SDK).
- Activación fail-closed (flags + proveedor + modelo + endpoint fijo + DB descartable + loopback + SYNTHETIC_DATA_ONLY).
- `FakeModelAdapter` sigue siendo el default del runtime.
- Dataset sintético versionado + evaluador + suite de seguridad.
- Eval live opcional: `WARA_V2_LLM_LIVE=true`.

## Fuera de alcance

- Canales reales, WhatsApp/BBC/WARA/Odoo, datos reales, Fase 9, push, producción.
