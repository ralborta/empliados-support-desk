# Checklist verificación mecánica — paquete 0.2.3

**Fecha:** 2026-08-11  
**Propósito:** facilitar la validación previa a H1–H6 (sin nueva arquitectura).

| # | Criterio | Evidencia primaria | ¿OK? |
|---|----------|--------------------|------|
| 1 | ADR-040 canónico; anteriores superseded | `WARA-REGISTRO-DE-DECISIONES.md` ADR-031/038 **SUPERSEDED**; ADR-040 | sí |
| 2 | Redis solo wakeup/secundario | Arquitectura §7.6; Modelo §1.5–1.6; ADR-004/040 | sí |
| 3 | PG única autoridad lease/owner/fence | Arquitectura §7 declaración; Modelo §3.3.1; ADR-040 | sí |
| 4 | Creación concurrente un ganador | Arquitectura §7.2 INSERT + UNIQUE; C52 | sí |
| 5 | INSERT ON CONFLICT DO NOTHING + RETURNING; sin fila ⇒ no acquired | Arquitectura §7.2 | sí |
| 6 | UPDATE solo lease vencida + RETURNING fence | Arquitectura §7.2 `lease_expires_at < now()` | sí |
| 7 | Solo acquire exitoso incrementa token | Arquitectura §7.2 / L1; C53 | sí |
| 8 | Renew/release condicionados cid+owner+fence | Arquitectura §7.4–7.5 | sí |
| 9 | Lease vencida no revive con renew | Arquitectura §7.4; C57 | sí |
| 10 | Comparaciones temporales con `now()` PG | Arquitectura §7.1 / L6 | sí |
| 11 | Pre-HTTP: owner, lease, fence, op, version, payload_hash | Arquitectura §7.3; Modelo attempt | sí |
| 12 | C51–C64 | `WARA-PLAN-DE-PRUEBAS-V2.md` | sí |

## Observación (no bloqueante de arquitectura)

En el modelo quedó una frase residual “lock temporal” en §1 punto 5; se alineó a “wakeup/secundario” para que el paquete no se contradiga con ADR-040. **No** es una 0.2.4 ni cambio de decisión.

## Sugerencia operativa (opcional, post–H1)

Al implementar, usar una sola función SQL/`SELECT acquire_conversation_lock(...)` que encapsule INSERT+UPDATE para evitar drift entre workers; el contrato documental ya es suficiente para scaffold.
