# Anexo — Corrección puntual 0.2.3 (ConversationLock PostgreSQL)

**Fecha:** 2026-08-11  
**Alcance:** solo `docs/v2/`

---

## Opinión

Coincidimos con el hallazgo: Redis→PG→Redis no es atómico entre stores; un worker puede “gastar” fence e invalidar al dueño legítimo sin poseer la lease. La autoridad única en PostgreSQL es la decisión correcta.

## 1. Secciones modificadas

| Documento | Qué |
|-----------|-----|
| `WARA-ARQUITECTURA-CONVERSACIONAL-V2.md` | §3–4 flujo; **§7 canónico ConversationLock** |
| `WARA-MODELO-DE-DATOS-V2.md` | §3.3.1 `ConversationLock`; elimina `lock_epoch` canónico |
| `WARA-PLAN-DE-PRUEBAS-V2.md` | C51–C64 (reemplazan C51–C57 de 0.2.2) |
| `WARA-PLAN-IMPLEMENTACION-Y-MIGRACION-V2.md` | checkpoint |
| `WARA-REGISTRO-DE-DECISIONES.md` | ADR-031/038 superseded; **ADR-040/041** |
| `WARA-MATRIZ-REUTILIZACION-V2.md` | ConversationLock |
| `ANEXO-DECISIONES-APROBACION-HUMANA.md` | H4 |
| Este anexo | |

## 2. ADR que reemplaza

**ADR-040** reemplaza ADR-031 y ADR-038 como mecanismo canónico de exclusión/fencing.

## 3. Algoritmo canónico (resumen)

* **Acquire:** `INSERT … ON CONFLICT DO NOTHING` o `UPDATE … WHERE lease_expires_at < now() SET fencing_token = fencing_token + 1 … RETURNING`
* **Validate pre-HTTP:** owner + lease vigente + fence turn/attempt + op + payload_hash (todo en PG)
* **Renew:** `UPDATE … WHERE owner AND fence AND lease_expires_at >= now()`
* **Release:** `UPDATE … WHERE owner AND fence` → expirar lease (fence no decrementa)

## 4. Constraints

* `ConversationLock.conversation_id` PK/UNIQUE  
* Solo acquire exitoso incrementa `fencing_token`  
* Renew no revive lease vencida  
* Reloj = `now()` PostgreSQL  

## 5. Pruebas agregadas/redefinidas

C51–C64 (simultáneas, primera fila, perdedor, expiry, stale wake, renew OK/FAIL, release wrong owner/token, Redis loss, Redis OK+lease vencida, wrong owner, crash pre/post HTTP).

## 6. Declaración

> **PostgreSQL es la única autoridad de lease y fencing.** Redis no concede, no incrementa fence, no invalida al propietario ni autoriza mutaciones externas.

## 7. Confirmación operativa

Sin código · sin rama · sin commits · sin EasyPanel · sin producción.

H1 / H1b / H2–H6: pendientes de validación. H7+: bloqueado.
