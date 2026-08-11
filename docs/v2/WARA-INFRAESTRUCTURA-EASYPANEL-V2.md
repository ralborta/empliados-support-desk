# WARA Conversacional V2 — Infraestructura EasyPanel

**Versión documental:** 0.2.1  
**Estado:** propuesta (aún **no** crear recursos)  
**Fecha:** 2026-08-11  
**Inspección MCP:** solo lectura previa (`list_projects`, `get_system_stats`)

---

## 1. Hallazgos de inspección

Sin cambios: no hay proyecto `wara` en EasyPanel; V1 vive en Vercel; otros proyectos (andreu, transitone, n8n, …) son **ajenos** y protegidos.  
MCP puede volcar envs ajenos: **prohibido** persistirlos en docs/logs/commits.

---

## 2. Lista de protección

Idem 0.1: no mutate servicios existentes, Vercel prod, BBC prod, DB prod, crons prod, ni compartir Postgres/Redis ajenos.

---

## 3. Proyecto propuesto `wara-v2`

### 3.1 Servicios — obligatorios vs postergables

| Nombre | ¿Día 0 EasyPanel? | Propósito |
|--------|-------------------|-----------|
| `wara-v2-postgres` | **Obligatorio** (o Postgres local hasta primer deploy) | verdad |
| `wara-v2-redis` | **Obligatorio** en deploy; local en scaffold | locks+wakeups |
| `wara-v2-api` | **Obligatorio** para entorno compartido | gateway |
| `wara-v2-worker` | **Obligatorio** | turns+reconcile+outbox drain |
| `wara-v2-migrate` | one-shot | migraciones |
| `wara-v2-panel` | **Postergable** | UI; local al inicio |
| `wara-v2-evaluator` | **Postergable** | CI/local; no servicio permanente inicial |

**Justificación:** panel y evaluator no son necesarios para validar gateway/cola/orquestador en dry_run; ahorran RAM/CPU y superficie de ataque. Panel se vuelve obligatorio antes de piloto humano; evaluator como gate CI antes de shadow.

### 3.2 Puertos / exposición

| Servicio | Puerto | Exposición |
|----------|--------|-----------|
| postgres | 5432 | **solo red privada** del proyecto |
| redis | 6379 | **solo red privada** + auth |
| api | 3000 | público vía proxy TLS EasyPanel |
| worker | metrics opcional interno | no público |
| panel (si existe) | 3001 | público TLS + RBAC |

### 3.3 Dominios

Solo subdominios de prueba, nunca `wara.nivel41.com`.

### 3.4 Variables (nombres)

Además de 0.1:

```
REDIS_URL                      # con password
REDIS_PASSWORD
WARA_V2_INBOUND_HMAC_SECRET
WARA_V2_INBOUND_MAX_SKEW_SEC=300
WARA_V2_ALLOW_INGRESS_COALESCE=false
WARA_V2_LOCK_TTL_SEC=30
WARA_V2_LOCK_MAX_HOLD_SEC=120
BACKUP_S3_BUCKET_OR_TARGET     # fuera del nodo
```

Flags mutación siguen en false por default.

---

## 4. Seguridad (0.2)

### 4.1 Red

- Servicios V2 en el mismo proyecto EasyPanel; DNS internos (`wara-v2-postgres:5432`, `wara-v2-redis:6379`).
- Postgres y Redis **sin** dominio público ni puertos publicados a Internet.
- API/panel detrás de proxy con **TLS**.

### 4.2 Redis

- `requirepass` / ACL; URL con credencial.
- Sin interfaz admin expuesta.

### 4.3 Inbound anti-replay

- Header firma HMAC (`timestamp` + `nonce` + body hash).
- Rechazar si `|now - timestamp| > MAX_SKEW`.
- Nonce store (Redis/PG) TTL ≥ 2×skew.
- API key V2 distinta de prod.

### 4.4 Rate limits

- Por IP y por teléfono/conversation en API.
- Límites de OpenAI calls por worker.

### 4.5 Panel RBAC

- Roles: `viewer`, `agent`, `admin_v2`.
- Sesión propia (no iron-session prod).
- Audit de acciones admin.

### 4.6 PII

- Cifrado en tránsito (TLS); en reposo = cifrado volumen PG si el proveedor lo ofrece.
- Redacción en logs y exports evaluator.
- Retención según política P6.

### 4.7 Secretos

- Solo en EasyPanel env / secret store.
- Rotación: procedimiento trimestral o al incidente; dual-key overlap corto para inbound HMAC.
- Nunca en git.

### 4.8 Backups

- `pg_dump`/snapshot **diario a destino fuera del mismo volumen/nodo** (object storage u otro host).
- Prueba de restauración **trimestral** documentada (restore a DB scratch V2).
- Redis: AOF; autoridad de negocio en PG.

---

## 5. Presupuesto RAM/CPU (todos simultáneos — día 0 mínimo)

Nodo observado ~8 GB RAM / 2 vCPU (inspección previa; puede cambiar).

| Servicio día 0 | CPU | RAM |
|----------------|-----|-----|
| postgres | 0.5 | 768MB |
| redis | 0.25 | 256MB |
| api | 0.5 | 512MB |
| worker | 0.75 | 768MB |
| **Total aprox** | ~2.0 | ~2.3GB |

Con panel+evaluator permanentes sumar ~0.5–1 GB.  
Cabe en el nodo con margen si no se colocalizan demasiados otros proyectos pesados; **re-medir** antes de create.

---

## 6. Dockerfile / health / rollback / escala

Igual 0.1: multi-stage; migrate separado; healthz/readyz; rollback solo servicios `wara-v2-*`; API/worker escalables con fencing+seq.

---

## 7. Confirmación humana antes de create

OK explícito a: proyecto, servicios día 0, dominios, secretos manuales, presupuesto, postergar panel/evaluator, y cero toque a no-V2.

**Esta iteración no crea nada.**
