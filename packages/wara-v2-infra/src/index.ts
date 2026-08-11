/**
 * Stub Fase 2 — infra local.
 * PG = lease/fence/seq. Redis = wakeup únicamente (ADR-040).
 */
import { PG_SOLE_LOCK_AUTHORITY, V2_DEFAULTS } from "@wara-v2/contracts";

export const PHASE = 2 as const;
export const INFRA_STUB = true as const;

export const localEnvDefaults = {
  WARA_V2_EXECUTION_MODE: V2_DEFAULTS.WARA_V2_EXECUTION_MODE,
  WARA_V2_ALLOW_WARA_MUTATIONS: "false",
  WARA_V2_ALLOW_ODOO_MUTATIONS: "false",
  WARA_V2_ALLOW_WHATSAPP_SEND: "false",
  /** Local compose ports — no EasyPanel; never V1 DATABASE_URL */
  WARA_V2_DATABASE_URL:
    "postgresql://wara_v2:wara_v2_local_dev_only@127.0.0.1:5433/wara_v2",
  REDIS_URL: "redis://:wara_v2_local_dev_only@127.0.0.1:6380/0",
  PG_SOLE_LOCK_AUTHORITY,
  REDIS_ROLE: "wakeup_secondary" as const,
};
