# Rollback — Mesa de Ayuda Wara

Guía para volver atrás **rápido** si algo falla en producción (`https://wara.nivel41.com`).

**Producción actual (referencia):** commit en `main` → ver con `git log -1 --oneline` o `./scripts/rollback-status.sh`.

---

## Nivel 1 — Inmediato (2–5 min, sin tocar código)

Desactiva **Fase 0** (webhook inbound vuelve a poder enviar WhatsApp al cliente).

### Vercel

1. [Vercel](https://vercel.com) → proyecto → **Settings** → **Environment Variables**
2. Agregar o editar:
   ```text
   WARA_INBOUND_AUDIT_ONLY=false
   ```
3. Aplicar a **Production** (y Preview si probás ahí).
4. **Deployments** → último deploy → **Redeploy** (o push vacío a `main`).

### Cuándo usarlo

- Escaladas duplicadas o mensajes raros del webhook **después** de Fase 0.
- Cliente deja de recibir algo que **solo** mandaba el inbound (código de caso, escalada automática).

### Volver a Fase 0 (modo recomendado)

```text
WARA_INBOUND_AUDIT_ONLY=true
```

O **borrar** la variable (por defecto el código usa audit-only = ON).

### Rollback Fase 2 (BBC vuelve a enviar `{message}`)

```text
WARA_TURN_BACKEND_SEND=false
```

Redeploy. Útil si falla `BUILDERBOT_API_KEY` / envío por API; BBC reenvía el JSON de `/turn`.

---

## Nivel 2 — Revertir solo Fase 0 en código (10–15 min)

Si el problema no es la variable sino el código de audit-only:

```bash
cd /ruta/al/repo
git fetch origin
git checkout main
git pull origin main

# Revierte Fase 0 + fix de cierre (orden: más reciente primero)
git revert 3af337f --no-edit
git revert 8f5db70 --no-edit
git push origin main
```

Vercel redeploya solo. **No uses** `git reset --hard` en `main`.

### Verificación post-rollback

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://wara.nivel41.com/
./scripts/rollback-status.sh
```

Prueba WhatsApp: un saludo + una consulta de unidad.

---

## Nivel 3 — Revertir fixes del 21/07 (patentes, Odoo, escalada)

Si fallan patentes (`LWK7902`), partner Odoo o match de unidades:

```bash
git revert 3af337f 8f5db70 c33c680 cec3e12 938bc04 b0ca4e3 a8c5601 --no-edit
git push origin main
```

Si algún revert choca (conflicto), revertí **de a uno** desde el más reciente:

```bash
git revert 3af337f --no-edit && git push origin main
# repetir con el siguiente commit si hace falta
```

**Punto estable anterior al bloque del 21/07:** `f836fb4` (stress tests).

Para volver exactamente a ese commit **sin borrar historial**:

```bash
git revert --no-commit 3af337f..a8c5601
git commit -m "Revertir bloque de fixes del 21/07 por incidente en producción."
git push origin main
```

(Ajustá el rango si git indica commits distintos; preferí reverts uno a uno.)

---

## Nivel 4 — Nuclear (solo emergencia)

Volver el **código** al demo estable previo al bloque reciente:

```bash
git revert --no-edit 3af337f 8f5db70 c33c680 cec3e12 938bc04 b0ca4e3 a8c5601 f836fb4 6fd2b06
git push origin main
```

**Commit de referencia “demo P0”:** `6fd2b06` — Corregir regresiones críticas del flujo demo WhatsApp.

Consultá con el equipo antes de revertir más de un día de trabajo.

---

## BBC (BuilderBot Cloud)

**Fase 0 y los fixes recientes no modifican flows BBC** en la nube. No hace falta rollback BBC por Fase 0.

**Fase 1 (futuro)** sí tocará BBC → ahí exportar snapshot de flows **antes** de sync (ver plan Fase 1).

---

## Durante la demo — plan de 30 segundos

| Síntoma | Acción |
|--------|--------|
| *"Tu consulta ha sido escalada…"* sin sentido | Nivel 1: confirmar deploy `3af337f` + audit ON; si persiste → Nivel 1 `false` |
| Patente incorrecta (ej. AB006EX) | Nivel 3 o humano desde panel; no es Fase 0 |
| Sin respuesta al cerrar caso | Verificar que BBC enruta a ejecutor Odoo; Nivel 2 solo si rompió el cierre |
| Caos general | Nivel 1 `false` + asesor responde desde panel + avisar dev |

---

## Contactos / logs

- **Logs Vercel:** proyecto → Deployments → último → **Functions** → `/api/whatsapp/inbound`, `/api/wara/unidades`
- Buscar: `[WhatsApp inbound audit]`, `[WaraAPI]`, errores 5xx
- **Panel:** tickets siguen en PostgreSQL (Railway); rollback de código **no borra** historial

---

## Checklist antes de Fase 1

- [ ] Fase 0 probada en WhatsApp (listado, patente, cierre)
- [ ] Variable `WARA_INBOUND_AUDIT_ONLY` documentada en Vercel
- [ ] Este archivo leído por quien opera la demo
- [ ] Snapshot de flows BBC exportado (cuando empiece Fase 1)
- [ ] Deploy backend con `/api/whatsapp/turn` (`docs/FASE-1.md`)
- [ ] `npm run sync-builderbot-inicio-turn` (rollback: `sync-builderbot-inicio-post.mjs`)
