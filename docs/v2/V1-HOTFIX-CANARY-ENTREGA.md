# Entrega — Canary V1 hotfix + recorrido WhatsApp

**Fecha:** 2026-08-12  
**Prod V1 fija:** `031dc5a` (sin promover `ad06d2a` sobre `wara.nivel41.com`)  
**Candidato hotfix:** `ad06d2a` + corrección local anti-recursión (sin commit a prod)

---

## 1. URL inmutable de fallback (031dc5a)

| Campo | Valor |
|-------|-------|
| SHA producción | `031dc5a` |
| Deployment Vercel (inmutable) | `https://empliados-support-desk-6gz1ojaeu-nivel-41.vercel.app` |
| Identificador parcial | `…6gz1ojaeu-nivel-41.vercel.app` |
| Alias **prohibido** como fallback | `wara.nivel41.com`, `*-git-main-*`, `*.nivel41.com` |

La URL de deployment **no sigue** al alias productivo: aunque `wara.nivel41.com` apunte al candidato, el fallback sigue apuntando al host `6gz1ojaeu`.

**Nota operativa:** el deployment inmutable responde con redirect SSO (302) sin `x-vercel-protection-bypass`. Configurar `WARA_V1_CANARY_FALLBACK_BYPASS_SECRET` en el candidato (env seguro Vercel), no en documentación.

Variables:

- `WARA_V1_HOTFIX_CANARY_FALLBACK_URL` o `WARA_V1_PRODUCTION_IMMUTABLE_URL` → solo URL deployment Vercel válida
- Default en código: `PRODUCTION_IMMUTABLE_FALLBACK_DEFAULT` en `src/lib/v1HotfixCanaryProxy.ts`

---

## 2. Anti-recursión y proxy seguro

Implementación: `src/lib/v1HotfixCanaryProxy.ts`, integrado en:

- `POST /api/whatsapp/turn`
- `POST /api/wara/odometro-horometro`

| Control | Comportamiento |
|---------|----------------|
| Header `x-wara-canary-proxy-hop: 1` | Seteado en cada proxy saliente |
| Segundo salto con canary ON | HTTP **508** `canary_proxy_loop_detected` |
| Prod estable (canary OFF) + hop | Procesa local (sin re-proxy) |
| Headers reenviados | `Content-Type`, `x-api-key`, hop; opcional bypass Vercel |
| **No** reenviados | Cookies, Authorization genérico, secretos internos |
| Timeout | 8 s → **504** `fallback_timeout` |
| Redirect fallback | **502** `fallback_redirect_blocked` |

### Prueba mecánica (local, verde)

```text
pnpm test:push
  ✓ verify-v1-hotfix-canary-gate.mjs
  ✓ verify-v1-hotfix-canary-proxy.mjs
```

Casos cubiertos:

- Alias `https://wara.nivel41.com` → `reject` (`fallback_url_alias_forbidden`)
- Externo → `proxy` a URL `*.vercel.app` deployment
- Allowlist interno → `process`
- Hop + canary ON → 508 (sin ciclo candidato → alias → candidato)

---

## 3. Recorrido real WhatsApp — **hoy NO hay canary real**

```
WhatsApp (+549…)
    → BBC (sin cambios)
    → POST https://wara.nivel41.com/api/whatsapp/turn
    → deployment prod 031dc5a
```

**Todos los números**, incluido `+5491133788190`, llegan hoy a **031dc5a** vía alias productivo.

La allowlist dentro del candidato (`WARA_V1_HOTFIX_CANARY_ALLOWLIST`) **no enruta tráfico BBC por sí sola**. Solo tiene efecto si BBC (o un replay HTTP) envía el POST **al deployment candidato** con canary ON.

### Alternativas aceptables (sin tocar BBC hoy)

| Modalidad | Qué es | Canary WhatsApp real |
|-----------|--------|----------------------|
| **Replay HTTP** al URL preview/candidato | Prueba funcional del hotfix | **No** |
| Router por número (diseño) | `docs/v2/ROUTER-PROGRESIVO-BBC-DISENO.md` | Futuro, no activo |
| Promover alias solo tras autorización | Cambiar target de `wara.nivel41.com` | Sí, pero **no autorizado** |

**No denominar “canary real de WhatsApp”** a pruebas donde BBC nunca entrega al candidato.

---

## 4. V1 sin cambios en prod

- Dominio productivo: **031dc5a**
- BBC / WhatsApp: **sin modificar**
- `ad06d2a`: candidato + canary interno; **no promovido**

`DATABASE_URL`: configurar solo en entorno seguro Vercel del preview/candidato (no documentar valor).
