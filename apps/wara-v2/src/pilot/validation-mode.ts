/**
 * Modo validación real extremadamente controlado — preparación sin ejecutar escrituras.
 */
import { writeGateSnapshot } from "./write-gates.js";

export type ValidationModeConfig = {
  enabled: boolean;
  tenantId: string | null;
  companyId: string | null;
  phoneE164: string | null;
  allowedUnits: string[];
  enabledOperation: "none" | "odoo_ticket" | "certificate" | "odometer";
};

export function loadValidationModeConfig(env: NodeJS.ProcessEnv = process.env): ValidationModeConfig {
  const enabled = (env.WARA_V2_VALIDATION_MODE ?? "").trim().toLowerCase() === "armed";
  const units = (env.WARA_V2_VALIDATION_ALLOWED_UNITS ?? "")
    .split(/[,;\s]+/)
    .map((p) => p.replace(/\s+/g, "").toUpperCase())
    .filter((p) => p.length >= 6);
  const opRaw = (env.WARA_V2_VALIDATION_OPERATION ?? "none").trim().toLowerCase();
  const enabledOperation =
    opRaw === "odoo_ticket" || opRaw === "certificate" || opRaw === "odometer" ? opRaw : "none";
  return {
    enabled,
    tenantId: env.WARA_V2_VALIDATION_TENANT?.trim() || null,
    companyId: env.WARA_V2_VALIDATION_COMPANY_ID?.trim() || null,
    phoneE164: env.WARA_V2_VALIDATION_PHONE?.trim() || null,
    allowedUnits: units,
    enabledOperation,
  };
}

export function sanitizePayloadForReview(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (/token|api[_-]?key|password|secret|authorization/i.test(k)) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      out[k] = sanitizePayloadForReview(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export type ProposedRealWrite = {
  operation: string;
  targetUnit: string;
  expectedEffect: string;
  reconciliation: string;
  sanitizedPayload: Record<string, unknown>;
  gates: ReturnType<typeof writeGateSnapshot>;
};

export function buildProposedWrites(env: NodeJS.ProcessEnv = process.env): ProposedRealWrite[] {
  const cfg = loadValidationModeConfig(env);
  const gates = writeGateSnapshot(env);
  const unit = cfg.allowedUnits[0] ?? "AA101AA";
  const proposals: ProposedRealWrite[] = [];

  proposals.push({
    operation: "odoo_ticket",
    targetUnit: unit,
    expectedEffect: "Crear ticket Helpdesk Odoo de prueba + registro Operation V2 succeeded",
    reconciliation: "Si timeout_after_send: status unknown_outcome + reconciliation pending; no reintentar automático",
    sanitizedPayload: sanitizePayloadForReview({
      subject: `${unit} - Validación interna V2`,
      description: "Ticket de prueba autorizado manualmente. No cliente real.",
      priority: "1",
    }),
    gates,
  });

  proposals.push({
    operation: "certificate",
    targetUnit: unit,
    expectedEffect: "POST Certificadocobertura → URL/documento WARA real",
    reconciliation: "Si HTTP OK sin URL: unknown_outcome; verificar en panel WARA antes de reintentar",
    sanitizedPayload: sanitizePayloadForReview({ patente: unit }),
    gates,
  });

  proposals.push({
    operation: "odometer",
    targetUnit: unit,
    expectedEffect: "POST RegistrarCambioOdometroHorometro con lectura aprobada",
    reconciliation: "Si timeout post-send: marcar reconciling; comparar lectura en WARA fleet",
    sanitizedPayload: sanitizePayloadForReview({
      patente: unit,
      odometro: 155000,
      fecha: "2026-08-12T15:00:00.000Z",
    }),
    gates,
  });

  return proposals;
}
