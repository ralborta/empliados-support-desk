/**
 * Gates independientes para efectos externos V2.
 * Ninguno habilita delivery ni todos los writes a la vez.
 */
export type WriteGateKind = "odometer" | "certificate" | "odoo" | "delivery";

export type WriteGateStatus = {
  kind: WriteGateKind;
  enabled: boolean;
  envVar: string;
  reason?: string;
};

function isTruthy(v: string | undefined): boolean {
  const t = (v ?? "").trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes" || t === "si";
}

export function isOdometerWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthy(env.WARA_V2_ODOMETER_WRITE_ENABLED);
}

export function isCertificateWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthy(env.WARA_V2_CERTIFICATE_WRITE_ENABLED);
}

export function isOdooWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthy(env.WARA_V2_ODOO_WRITE_ENABLED);
}

export function isDeliveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthy(env.WARA_V2_DELIVERY_ENABLED);
}

/** @deprecated usar gates específicos; nunca habilitar globalmente en prod. */
export function isLegacyGlobalMutationsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ALLOW_EXTERNAL_MUTATIONS === "true";
}

export function assertWriteGate(kind: WriteGateKind, env: NodeJS.ProcessEnv = process.env): void {
  const map: Record<WriteGateKind, { enabled: () => boolean; envVar: string }> = {
    odometer: { enabled: () => isOdometerWriteEnabled(env), envVar: "WARA_V2_ODOMETER_WRITE_ENABLED" },
    certificate: { enabled: () => isCertificateWriteEnabled(env), envVar: "WARA_V2_CERTIFICATE_WRITE_ENABLED" },
    odoo: { enabled: () => isOdooWriteEnabled(env), envVar: "WARA_V2_ODOO_WRITE_ENABLED" },
    delivery: { enabled: () => isDeliveryEnabled(env), envVar: "WARA_V2_DELIVERY_ENABLED" },
  };
  const g = map[kind];
  if (!g.enabled()) {
    throw new Error(`${g.envVar} no está habilitado`);
  }
}

export function writeGateSnapshot(env: NodeJS.ProcessEnv = process.env): WriteGateStatus[] {
  return (["odometer", "certificate", "odoo", "delivery"] as WriteGateKind[]).map((kind) => {
    const enabled =
      kind === "odometer"
        ? isOdometerWriteEnabled(env)
        : kind === "certificate"
          ? isCertificateWriteEnabled(env)
          : kind === "odoo"
            ? isOdooWriteEnabled(env)
            : isDeliveryEnabled(env);
    const envVar =
      kind === "odometer"
        ? "WARA_V2_ODOMETER_WRITE_ENABLED"
        : kind === "certificate"
          ? "WARA_V2_CERTIFICATE_WRITE_ENABLED"
          : kind === "odoo"
            ? "WARA_V2_ODOO_WRITE_ENABLED"
            : "WARA_V2_DELIVERY_ENABLED";
    return { kind, enabled, envVar };
  });
}

export function pilotPersistenceMode(env: NodeJS.ProcessEnv = process.env): "prisma" | "json" | "dual" {
  const raw = (env.WARA_V2_PILOT_PERSISTENCE ?? "").trim().toLowerCase();
  if (raw === "json") return "json";
  if (raw === "dual") return "dual";
  if (raw === "prisma" || env.WARA_V2_DATABASE_URL?.trim()) return "prisma";
  return "json";
}

export function isPrismaPersistencePrimary(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = pilotPersistenceMode(env);
  return mode === "prisma" || mode === "dual";
}

/** Lab/dry-run cuando el gate específico está apagado. */
export function isPilotDryRun(kind: WriteGateKind, env: NodeJS.ProcessEnv = process.env): boolean {
  const enabled =
    kind === "odometer"
      ? isOdometerWriteEnabled(env)
      : kind === "certificate"
        ? isCertificateWriteEnabled(env)
        : kind === "odoo"
          ? isOdooWriteEnabled(env)
          : isDeliveryEnabled(env);
  // Certificado: el gate específico alcanza (lab shadow no puede prender
  // ALLOW_EXTERNAL_MUTATIONS sin romper el canary).
  if (kind === "certificate") return !enabled;
  return !enabled || env.ALLOW_EXTERNAL_MUTATIONS !== "true";
}
