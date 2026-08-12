# V2 — Capa semántica de búsqueda conversacional

**Estado:** listo para prueba humana en `/lab/chat`  
**Restricción:** sin frontend productivo, sin bridge activo, sin router V2, sin WhatsApp productivo, sin escrituras WARA.

---

## Causa raíz exacta

V2 en `e53d9d1` (y anteriores) enrutaba búsquedas de unidad con **`extractSearchToken`**, que devolvía **fragmentos literales del mensaje** (`"a q empieza con ad"`, `"patentre q empieza con AD"`, `"con AA82"`) y los pasaba a `filterUnitsBySearchTerms` / mensajes `No encontré «…»`.

V1 ya separaba intención, entidad, operador y valor en:

- `src/lib/utteranceUnderstanding.ts` (LLM + esquema `UtteranceUnderstanding`)
- `src/lib/waraUnitIntent.ts` + `filterUnitsByPlatePrefix` en `wara.ts`

V2 **no tenía esa capa integrada** en el piloto; solo reglas parciales y fallback LLM genérico al final del turno.

---

## Solución implementada

### 1. Capa semántica tipada (`unit-search-semantics.ts`)

Esquema Zod:

```typescript
{
  intent: "unit_status" | "find_unit" | "select_index" | "contextual_ref",
  entity: "license_plate" | "unit_name" | "brand",
  matchMode: "exact" | "prefix" | "suffix" | "contains" | "index" | "contextual",
  query: string,
  confidence: "high" | "medium" | "low",
  source: "rules" | "llm"
}
```

Reglas determinísticas primero; tolerancia a typos (`patentre`), sin tildes, abreviaturas (`la q`, `dominio`→`patente`).

### 2. Resolución determinística sobre WARA (`unit-search-resolver.ts`)

Operadores implementados sobre flota real:

| Modo | Ejemplo |
|------|---------|
| `exact` | `AD356UQ`, `MYQ` |
| `prefix` | `empieza con AD`, `AA815`, `con AA82` |
| `suffix` | `termina en XU` |
| `contains` | `las que tengan 815` |
| `index` | `22`, `la segunda` |
| `contextual` | `esa`, `la de arriba`, `donde está esa?`, `la siguiente` |

**Contexto de listado vigente:** si hay `lastListing` fresco, prefijo/contiene/sufijo busca primero en ese subconjunto (ej. `AA815` tras listado AA 815 XE/XF/…).

**Nunca** reutiliza silenciosamente `selectedUnit` si la búsqueda actual no coincide.

### 3. LLM opcional (`utterance-understanding-v2.ts`)

- Variable: `WARA_V2_UTTERANCE_UNDERSTANDING` (default: encendido si hay `OPENAI_API_KEY`)
- Modelo: `WARA_V2_UTTERANCE_MODEL` (default `gpt-4o-mini`)
- Solo enriquece interpretación; **no ejecuta búsquedas ni afirma resultados**
- Desactivado en tests (`useLlm: false`)

### 4. Integración en turno (`unit-search-turn.ts` + `operational-turn.ts`)

Flujo unificado reemplaza paths dispersos de `resolveUnitForGps` + `searchToken`.

---

## Conversación corregida (mock El Cacique)

| Usuario | V2 corregido |
|---------|--------------|
| `el estado de la q empieza con ad` | `Encontré 2 unidades para el estado GPS con «AD»…` + listado AD 356 UQ, AD 999 ZZ |
| `AD` | Listado 2 unidades prefijo AD |
| `la patente q empieza con AD` | Listado 2 unidades (sin error «patentre») |
| `con AA82` | Listado AA 820 BB, AA 821 CC (prefijo AA82) |
| `AA815` | Listado 3–4 unidades AA 815 X* (no «No encontré») |

---

## Comparación V1 vs V2

| Aspecto | V1 | V2 (esta entrega) |
|---------|----|--------------------|
| Capa semántica | `utteranceUnderstanding.ts` | `unit-search-semantics.ts` + LLM V2 |
| Prefijos naturales | Sí | Sí (port + ampliado) |
| Contains / suffix | Sí | Sí |
| Contexto listado | Sí | Sí (`lastListing` + `lastListingPickIndex`) |
| Tests conversacionales humanos | Parcial en V1 | `human-conversation.test.ts` (12 casos) |
| Escrituras WARA | Según flujo V1 | **Cero** (piloto read-only) |
| WhatsApp productivo | Sí | **Cero** (solo `/lab/chat` shadow) |

V2 **no se activa en producción** hasta aprobación humana de Raúl en `/lab/chat`.

---

## Tests

```bash
cd apps/wara-v2
pnpm exec tsx --test src/pilot/human-conversation.test.ts
pnpm exec tsx --test src/pilot/conversation-parity.test.ts
pnpm test:shadow-canary   # 90 tests (incluye 12 nuevos humanos)
```

Frases cubiertas en tests:

- `la q empieza con ad`, `el estado de la que empieza con AD`
- `buscame las patentes AD`, `alguna patente que arranque en ad`
- `con AA82`, `AA815`, `la de arriba`, `la segunda`
- `mostrame las que tengan 815`, `termina en XU`
- `sí` no confundido con prefijo `SI`
- patente inexistente no reutiliza unidad anterior

---

## Prueba manual

1. URL: https://wara-v2.wd75db.easypanel.host/lab/chat  
2. Teléfono emulado: `+5491133788190` (El Cacique S.A.)  
3. Repetir conversación de la captura original  
4. Verificar listados numerados y selección por índice

---

## Deploy v2-shadow

Tras commit y push a la rama de lab:

- Servicio: **v2-shadow** (EasyPanel / Railway)
- Solo backend piloto; **no** desplegar `front-v2-lab` ni productivo
- Confirmar `GIT_COMMIT_SHA` en `/health` tras deploy

---

## Confirmaciones de seguridad

| Gate | Estado |
|------|--------|
| Escrituras WARA reales | **OFF** (`write-gates.ts`) |
| Router V2 productivo | **OFF** (`WARA_V2_ROUTER_ENABLED=false`) |
| WhatsApp productivo | **Sin conexión** (lab chat HTTP aislado) |
| Bridge tickets lab | Solo en derivación explícita |

---

## Archivos principales

- `apps/wara-v2/src/pilot/unit-search-semantics.ts`
- `apps/wara-v2/src/pilot/unit-search-resolver.ts`
- `apps/wara-v2/src/pilot/unit-search-turn.ts`
- `apps/wara-v2/src/pilot/utterance-understanding-v2.ts`
- `apps/wara-v2/src/pilot/plate-prefix.ts` (contains, arranque, patentes AD)
- `apps/wara-v2/src/pilot/human-conversation.test.ts`
