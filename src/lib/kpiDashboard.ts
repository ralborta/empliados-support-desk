import type {
  AgentRole,
  Prisma,
  Ticket,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from "@prisma/client";
import {
  ADVISOR_ACTIVE_TICKET_STATUSES,
  ADVISOR_PRESENCE_TIMEOUT_MS,
  isAdvisorPresentlyOnline,
} from "@/lib/advisorDistribution";
import { normalizeCustomerOdooCaseRef } from "@/lib/customerOdooCaseRef";

/** Contrato del dashboard (PDF requerimientos). */
export type KpiModoResolucion = "KIRA_AUTO" | "HUMAN" | "IDLE_TIMEOUT";
export type KpiMotivoDerivacion =
  | "REQUIERE_GESTION_HUMANA"
  | "NO_RESUELTO"
  | "PEDIDO_CLIENTE"
  | null;

export type KpiTicketDto = {
  id: string;
  code: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  estado: string;
  prioridad: string;
  categoria: string;
  tipoIncidente: string | null;
  modoResolucion: KpiModoResolucion;
  motivoDerivacion: KpiMotivoDerivacion;
  asignadoA: string | null;
  derivadoAAsesorAt: string | null;
  primeraRespuestaHumanaAt: string | null;
  odooTicketId: number | null;
  odooTicketRef: string | null;
  cliente: string | null;
  /** Campos internos útiles; no PII de mensajes/teléfono. */
  _approx: {
    resolvedAtSource: "updatedAt_when_closed" | "null_open";
    modoResolucionSource: string;
    odooFromPayload: boolean;
  };
};

export type KpiAdvisorDto = {
  id: string;
  nombre: string;
  rol: AgentRole;
  conectado: boolean;
  conectadoDesde: string | null;
  lastSeenAt: string | null;
  ticketsAbiertos: number;
  slotsDisponibles: number | null;
};

const ESTADO_MAP: Record<TicketStatus, string> = {
  OPEN: "PENDIENTE",
  IN_PROGRESS: "EN_PROGRESO",
  WAITING_CUSTOMER: "ESPERANDO_CLIENTE",
  RESOLVED: "RESUELTO",
  CLOSED: "CERRADO",
};

const PRIORIDAD_MAP: Record<TicketPriority, string> = {
  LOW: "BAJA",
  NORMAL: "NORMAL",
  HIGH: "ALTA",
  URGENT: "URGENTE",
};

const CATEGORIA_MAP: Record<TicketCategory, string> = {
  TECH_SUPPORT: "SOPORTE_TECNICO",
  BILLING: "FACTURACION",
  SALES: "VENTAS",
  OTHER: "OTRO",
};

export const KPI_CATALOGS = {
  estado: Object.values(ESTADO_MAP),
  prioridad: Object.values(PRIORIDAD_MAP),
  categoria: Object.values(CATEGORIA_MAP),
  tipoIncidente: [
    "MISSING_REPORT",
    "ODOMETER_CHANGE",
    "HOROMETER_CHANGE",
    "CERTIFICATE",
    "MAINTENANCE",
    "ADMIN_DERIVATION",
    "ACCESS_PLATFORM",
    "OTHER",
  ],
  modoResolucion: ["KIRA_AUTO", "HUMAN", "IDLE_TIMEOUT"] as const,
  motivoDerivacion: [
    "REQUIERE_GESTION_HUMANA",
    "NO_RESUELTO",
    "PEDIDO_CLIENTE",
  ] as const,
  nota: "V1: mapeo sobre datos operativos actuales de Kira. motivoDerivacion suele ser null salvo indicios claros (p. ej. ticket Odoo).",
} as const;

function iso(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString();
}

function isClosedStatus(status: TicketStatus): boolean {
  return status === "RESOLVED" || status === "CLOSED";
}

type PayloadBag = Record<string, unknown>;

function asRecord(v: unknown): PayloadBag | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as PayloadBag;
}

export function extractOdooFromPayload(payload: unknown): {
  odooTicketId: number | null;
  odooTicketRef: string | null;
} {
  const p = asRecord(payload);
  if (!p) return { odooTicketId: null, odooTicketRef: null };

  let odooTicketId: number | null = null;
  const rawId = p.odooTicketId ?? p.odoo_ticket_id ?? p.ticket_id;
  if (typeof rawId === "number" && Number.isFinite(rawId)) odooTicketId = rawId;
  else if (typeof rawId === "string" && /^\d+$/.test(rawId.trim())) {
    odooTicketId = Number(rawId.trim());
  }

  const refRaw =
    (typeof p.odooRef === "string" && p.odooRef) ||
    (typeof p.ref === "string" && p.ref) ||
    (typeof p.odooTicketRef === "string" && p.odooTicketRef) ||
    null;
  const odooTicketRef = normalizeCustomerOdooCaseRef(refRaw);

  if (!odooTicketId && odooTicketRef && /^\d+$/.test(odooTicketRef)) {
    odooTicketId = Number(odooTicketRef);
  }

  return { odooTicketId, odooTicketRef };
}

export function inferModoResolucion(ticket: {
  status: TicketStatus;
  resolvedByAI: boolean;
  resolution: string | null;
  assignedToUserId: string | null;
  hasHumanOutbound: boolean;
  hasEscalationEvent: boolean;
}): { modo: KpiModoResolucion; source: string } {
  const resolution = String(ticket.resolution ?? "").toUpperCase();
  if (resolution.includes("IDLE_TIMEOUT") || resolution.includes("IDLE-TIMEOUT")) {
    return { modo: "IDLE_TIMEOUT", source: "resolution_idle" };
  }
  if (
    ticket.assignedToUserId ||
    ticket.hasHumanOutbound ||
    ticket.hasEscalationEvent
  ) {
    return { modo: "HUMAN", source: "assigned_or_human_or_escalated" };
  }
  if (ticket.resolvedByAI && isClosedStatus(ticket.status)) {
    return { modo: "KIRA_AUTO", source: "resolvedByAI_closed" };
  }
  if (isClosedStatus(ticket.status)) {
    return { modo: "KIRA_AUTO", source: "closed_without_human" };
  }
  return { modo: "KIRA_AUTO", source: "open_unassigned_bot" };
}

export function inferMotivoDerivacion(opts: {
  modo: KpiModoResolucion;
  odooTicketId: number | null;
}): KpiMotivoDerivacion {
  if (opts.modo !== "HUMAN") return null;
  if (opts.odooTicketId != null) return "REQUIERE_GESTION_HUMANA";
  return null;
}

export type TicketForKpi = Ticket & {
  customer: { companyName: string | null; name: string | null };
  messages: Array<{
    from: string;
    direction: string;
    createdAt: Date;
    rawPayload: unknown;
  }>;
  events: Array<{ type: string; createdAt: Date; payload: unknown }>;
};

export function mapTicketToKpiDto(ticket: TicketForKpi): KpiTicketDto {
  const hasHumanOutbound = ticket.messages.some(
    (m) => m.from === "HUMAN" && m.direction === "OUTBOUND",
  );
  const hasEscalationEvent = ticket.events.some((e) => e.type === "ESCALATED");

  let odooTicketId: number | null = null;
  let odooTicketRef: string | null = null;
  let odooFromPayload = false;
  for (const m of ticket.messages) {
    const found = extractOdooFromPayload(m.rawPayload);
    if (found.odooTicketId != null || found.odooTicketRef) {
      odooTicketId = found.odooTicketId ?? odooTicketId;
      odooTicketRef = found.odooTicketRef ?? odooTicketRef;
      odooFromPayload = true;
      if (odooTicketId != null) break;
    }
  }
  for (const e of ticket.events) {
    const found = extractOdooFromPayload(e.payload);
    if (found.odooTicketId != null || found.odooTicketRef) {
      odooTicketId = found.odooTicketId ?? odooTicketId;
      odooTicketRef = found.odooTicketRef ?? odooTicketRef;
      odooFromPayload = true;
      if (odooTicketId != null) break;
    }
  }

  const { modo, source } = inferModoResolucion({
    status: ticket.status,
    resolvedByAI: ticket.resolvedByAI,
    resolution: ticket.resolution,
    assignedToUserId: ticket.assignedToUserId,
    hasHumanOutbound,
    hasEscalationEvent,
  });

  const assignedEvent = ticket.events
    .filter((e) => e.type === "ASSIGNED" || e.type === "ESCALATED")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  const firstHuman = ticket.messages
    .filter((m) => m.from === "HUMAN" && m.direction === "OUTBOUND")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

  const closed = isClosedStatus(ticket.status);

  return {
    id: ticket.id,
    code: ticket.code,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    resolvedAt: closed ? ticket.updatedAt.toISOString() : null,
    estado: ESTADO_MAP[ticket.status],
    prioridad: PRIORIDAD_MAP[ticket.priority],
    categoria: CATEGORIA_MAP[ticket.category],
    tipoIncidente: ticket.incidentType ?? null,
    modoResolucion: modo,
    motivoDerivacion: inferMotivoDerivacion({ modo, odooTicketId }),
    asignadoA: ticket.assignedToUserId,
    derivadoAAsesorAt: iso(assignedEvent?.createdAt ?? null),
    primeraRespuestaHumanaAt: iso(firstHuman?.createdAt ?? null),
    odooTicketId,
    odooTicketRef,
    cliente: ticket.customer.companyName ?? ticket.customer.name ?? null,
    _approx: {
      resolvedAtSource: closed ? "updatedAt_when_closed" : "null_open",
      modoResolucionSource: source,
      odooFromPayload,
    },
  };
}

export const KPI_TICKET_INCLUDE = {
  customer: { select: { companyName: true, name: true } },
  messages: {
    orderBy: { createdAt: "desc" as const },
    take: 80,
    select: { from: true, direction: true, createdAt: true, rawPayload: true },
  },
  events: {
    orderBy: { createdAt: "asc" as const },
    take: 40,
    select: { type: true, createdAt: true, payload: true },
  },
} satisfies Prisma.TicketInclude;

export type KpiListCursor = {
  updatedAt: string;
  id: string;
};

export function encodeKpiCursor(c: KpiListCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export function decodeKpiCursor(raw: string | null): KpiListCursor | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as KpiListCursor;
    if (!parsed?.updatedAt || !parsed?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function mapAdvisorToKpiDto(agent: {
  id: string;
  name: string;
  role: AgentRole;
  sessionActive: boolean;
  lastSeenAt: Date | null;
  presenceStartedAt: Date | null;
  _count: { tickets: number };
}): KpiAdvisorDto {
  const conectado = isAdvisorPresentlyOnline(agent);
  return {
    id: agent.id,
    nombre: agent.name,
    rol: agent.role,
    conectado,
    conectadoDesde: conectado ? iso(agent.presenceStartedAt) : null,
    lastSeenAt: iso(agent.lastSeenAt),
    ticketsAbiertos: agent._count.tickets,
    /** No hay soft-cap de slots en Kira hoy; null = sin límite configurado. */
    slotsDisponibles: null,
  };
}

export { ADVISOR_ACTIVE_TICKET_STATUSES, ADVISOR_PRESENCE_TIMEOUT_MS };
