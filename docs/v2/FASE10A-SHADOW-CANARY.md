# Fase 10A — Shadow canary en EasyPanel (NO Vercel)

## Corrección de runtime

El canary y el tráfico V1/V2 de esta fase se operan en **EasyPanel** (front + backend).
No se asume Vercel como destino de activación.

## Proyecto EasyPanel creado: `wara`

Servicios (nuevos, sin tocar otros proyectos ni `wara.nivel41.com`):

| Servicio | Rol | Dominio |
|----------|-----|---------|
| `front` | Next.js UI | https://wara-front.wd75db.easypanel.host |
| `backend` | Next.js API / turn | https://wara-backend.wd75db.easypanel.host |
| `postgres` | DB privada | sin puerto público |
| `redis` | locks/cola | sin puerto público |
| `v2-shadow` | canary 10A | **sin dominio público** (red interna :8787) |

Source GitHub: `ralborta/empliados-support-desk` branch **`main`** (la rama 10A aún no está en origin). Auto-deploy: OFF.

## Flags a setear en EasyPanel (backend que corre `whatsappTurn`)

```bash
WARA_V2_SHADOW=true
WARA_V2_SHADOW_CANARY=true
WARA_V2_SHADOW_KILL=false
EVALUATION_ONLY=true
DELIVERY_ENABLED=false
ALLOW_EXTERNAL_MUTATIONS=false
REAL_CHANNELS_ENABLED=false
WARA_V2_SHADOW_TENANT=tenant_internal_ops
WARA_V2_SHADOW_ALLOWLIST=+5491133788190
# opcional, DNS interno EasyPanel:
# WARA_V2_SHADOW_URL=http://wara-v2-shadow:8787/v2/shadow-canary
```

## Comportamiento

1. El mensaje sigue en V1 (EasyPanel).
2. Hook fire-and-forget **in-process** (`setImmediate`) — sin `waitUntil` de Vercel.
3. Copia opcional HTTP al servicio shadow interno.
4. Cero WhatsApp / ops / outbox desde V2.

## Activación

1. Confirmar nombres de proyecto/servicios EasyPanel front+back.
2. Desplegar commit con el hook a esos servicios.
3. Setear flags solo en backend (allowlist de un número).
4. Observar 10 conversaciones; kill switch = `WARA_V2_SHADOW_KILL=true`.

Sin push/deploy hasta autorización explícita de despliegue EasyPanel.
