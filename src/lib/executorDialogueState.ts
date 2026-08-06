/**
 * Estado estructurado que devuelven los executors para que el agente RAZONE y redacte —
 * el cliente nunca debería ver plantillas crudas del backend cuando WARA_AGENT_MODE está activo.
 */

export type ExecutorDialogueState = {
  tramite: "consulta_unidad" | "odometro" | "mantenimiento" | "certificado" | "guia" | "otro";
  fase: string;
  /** Patente corta para mencionar ("MYQ 693"), no el bloque nombre+largo. */
  unidad_corta?: string;
  unidad_nombre?: string;
  /** Hechos verificados — el agente solo puede usar estos, no inventar. */
  hechos: string[];
  /** Pregunta concreta del cliente en este turno (si se detectó). */
  pregunta_cliente?: string;
  caso_abierto?: boolean;
  /** Número Odoo (solo dígitos). Si está, la respuesta DEBE incluir *#NNNN*. */
  caso_odoo?: string;
  /** True si el caso Odoo ya existía (no se creó en este turno). */
  caso_reutilizado?: boolean;
  /** Cosas que el agente NO debe hacer en la redacción. */
  prohibido?: string[];
};

export function buildExecutorDialoguePayload(state: ExecutorDialogueState): Record<string, unknown> {
  return { dialogue_state: state };
}

export function parseExecutorDialogueState(
  raw: Record<string, unknown> | null | undefined,
): ExecutorDialogueState | null {
  const ds = raw?.dialogue_state;
  if (!ds || typeof ds !== "object") return null;
  const o = ds as Record<string, unknown>;
  if (!Array.isArray(o.hechos)) return null;
  return {
    tramite: (o.tramite as ExecutorDialogueState["tramite"]) ?? "otro",
    fase: String(o.fase ?? ""),
    unidad_corta: o.unidad_corta ? String(o.unidad_corta) : undefined,
    unidad_nombre: o.unidad_nombre ? String(o.unidad_nombre) : undefined,
    hechos: o.hechos.map(String),
    pregunta_cliente: o.pregunta_cliente ? String(o.pregunta_cliente) : undefined,
    caso_abierto: o.caso_abierto === true,
    caso_odoo: o.caso_odoo ? String(o.caso_odoo).replace(/^#/, "") : undefined,
    caso_reutilizado: o.caso_reutilizado === true,
    prohibido: Array.isArray(o.prohibido) ? o.prohibido.map(String) : undefined,
  };
}

export function agentComposeRequested(raw: Record<string, unknown>): boolean {
  return String(raw.agent_compose_s ?? "") === "true";
}
