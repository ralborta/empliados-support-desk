# Anexo — Corrección puntual 0.2.2 (carrera lock/fencing)

**Fecha:** 2026-08-11  
**Alcance:** solo docs `docs/v2/` · sin ampliación de producto

---

## Problema

En 0.2.1, `lock_epoch++` en PostgreSQL ocurría **antes** de `SET Redis NX`. Un contendiente podía incrementar la época, fallar NX y dejar obsoleto al propietario legítimo del lock.

## Corrección

Orden canónico: **Redis NX provisional → (solo ganador) PG `lock_epoch++` → Lua a `owner:fence` → verificación triple pre-HTTP**.

## Documentos modificados

| Documento | Cambio |
|-----------|--------|
| `WARA-ARQUITECTURA-CONVERSACIONAL-V2.md` | §3–4 flujo; **§7 completo** (algoritmo 0.2.2 + invariantes L1–L5) |
| `WARA-MODELO-DE-DATOS-V2.md` | constraint de uso de `lock_epoch`; attempt owner+fence |
| `WARA-PLAN-DE-PRUEBAS-V2.md` | casos **C51–C57** |
| `WARA-REGISTRO-DE-DECISIONES.md` | ADR-031 nota; **ADR-038**; ADR-039 |
| Este anexo | registro de la corrección |

## Pruebas nuevas

C51 simultáneas · C52 NX fail no invalida · C53 crash pre-PG · C54 expiry pre-Lua · C55 Redis restore/loss · C56 fence &lt; PG · C57 sin ownership Redis.

## Confirmación operativa

- No se modificó código funcional.
- No se creó rama.
- No se hicieron commits.
- No se creó infraestructura EasyPanel.
- No se tocó producción.

## Estado de aprobaciones

H1 / H1b / H2–H6: **aún no autorizados** (pendiente validación de esta corrección).  
H7+: **bloqueado**.
