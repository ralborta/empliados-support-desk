# WARA Conversacional V2 — App scaffold (Fase 1)

Doc de referencia: `docs/v2/` versión **0.2.3**.

## Qué incluye esta fase

- Paquetes `packages/wara-v2-*` + esta app.
- Contratos Zod + JSON Schema `OrchestratorDecision` v2.1.
- Stubs de API/worker **sin** bind HTTP productivo.
- `docker-compose.wara-v2.yml` (Postgres + Redis **local**).
- Mode default: `dry_run`.
- Mutaciones WARA/Odoo: **off**.
- Envío WhatsApp/BBC: **off**.

## Qué NO incluye

- EasyPanel / producción (H7+ bloqueado).
- Migraciones Prisma V2 (Fase 2).
- ConversationLock runtime (tipos en contracts; SQL en Fase 2/4).
- Orquestador LLM real.

## Comandos

```bash
# desde la raíz del repo
pnpm install
pnpm --filter @wara-v2/contracts test
pnpm --filter @wara-v2/app typecheck

# infra local opcional (no EasyPanel)
docker compose -f docker-compose.wara-v2.yml up -d
```

## Autoridad de lock

PostgreSQL `ConversationLock` es la única autoridad de lease/owner/fence (ADR-040).  
Redis solo wakeup/secundario.
