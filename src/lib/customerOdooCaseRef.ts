import type { Prisma, PrismaClient } from "@prisma/client";

type JsonPayload = Record<string, unknown>;
type DbClient = PrismaClient | Prisma.TransactionClient;

function payloadField(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as JsonPayload)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Referencia Odoo visible al cliente (solo dígitos, ej. 36248). Nunca código local TCK-*. */
export function normalizeCustomerOdooCaseRef(raw: string | null | undefined): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/^#/, "").replace(/\s+/g, "");
  if (/^\d+$/.test(digits)) return digits;
  const hashMatch = trimmed.match(/#\s*(\d+)/);
  if (hashMatch?.[1]) return hashMatch[1];
  const odooMatch = trimmed.match(/\(\s*#\s*(\d+)\s*\)/);
  if (odooMatch?.[1]) return odooMatch[1];
  return null;
}

export function formatCustomerOdooCaseRefForWhatsApp(ref: string): string {
  const norm = normalizeCustomerOdooCaseRef(ref);
  return norm ? `#${norm}` : ref;
}

const ODOO_REF_PAYLOAD_KEYS = ["odooRef", "ref"] as const;

function odooRefFromPayload(payload: unknown, plateFilter?: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as JsonPayload;
  if (plateFilter) {
    const msgPlate = String(p.plate ?? "")
      .replace(/\s+/g, "")
      .toUpperCase();
    if (msgPlate && msgPlate !== plateFilter) return null;
  }
  for (const key of ODOO_REF_PAYLOAD_KEYS) {
    const norm = normalizeCustomerOdooCaseRef(payloadField(p, key));
    if (norm) return norm;
  }
  const odooTicketId = p.odooTicketId;
  if (typeof odooTicketId === "number" && Number.isFinite(odooTicketId)) {
    return String(odooTicketId);
  }
  return null;
}

/**
 * Número de caso Odoo asociado al cliente/ticket — única referencia que debe ver el cliente.
 * No devuelve códigos locales del panel (TCK-…).
 */
export async function findCustomerVisibleOdooCaseRef(
  client: DbClient,
  opts: {
    customerId: string;
    ticketId?: string;
    plate?: string;
    maxMessages?: number;
  },
): Promise<string | null> {
  const plateFilter = opts.plate?.replace(/\s+/g, "").toUpperCase() || undefined;
  const take = opts.maxMessages ?? 48;

  const msgs = await client.ticketMessage.findMany({
    where: opts.ticketId
      ? { ticketId: opts.ticketId }
      : { ticket: { customerId: opts.customerId } },
    orderBy: { createdAt: "desc" },
    take,
    select: { rawPayload: true, text: true },
  });

  for (const m of msgs) {
    const fromPayload = odooRefFromPayload(m.rawPayload, plateFilter);
    if (fromPayload) return fromPayload;
    const fromText = m.text?.match(/(?:caso|ticket)\s*(?:odoo\s*)?(?:N[°º]\s*|#\s*)?(\d{4,8})/i);
    if (fromText?.[1]) return fromText[1];
  }

  return null;
}

/** Texto cuando el cliente pide el número de caso y solo hay registro local (sin Odoo aún). */
export function buildCaseRegisteredWithoutOdooRefReply(): string {
  return "Tu consulta quedó registrada y un asesor de Atención al cliente la va a revisar. Te avisamos por este medio cualquier novedad.";
}

export function buildCustomerExplicitCaseNumberReply(odooRef: string): string {
  const display = formatCustomerOdooCaseRefForWhatsApp(odooRef);
  return `Tu número de caso es *${display}*. Guardalo para cualquier consulta con Mesa de Ayuda.`;
}

export function buildCustomerEscalationWithCaseReply(odooRef: string): string {
  const display = formatCustomerOdooCaseRefForWhatsApp(odooRef);
  return `Hola! Tu consulta ha sido escalada a nuestro equipo. Caso *${display}*. Te responderemos pronto.`;
}

/**
 * Mensaje al cliente cuando se creó o reutilizó un caso en Odoo Helpdesk.
 * Solo usar si hay odooRef real — nunca TCK-* local.
 */
export function buildCustomerOdooCaseAssignedReply(
  odooRef: string,
  opts?: { reused?: boolean },
): string {
  const display = formatCustomerOdooCaseRefForWhatsApp(odooRef);
  if (opts?.reused) {
    return `Ya tenés un caso en revisión (*${display}*). Un asesor de Atención al cliente te va a contactar por este medio.`;
  }
  return `Tu caso es *${display}*. Un asesor de Atención al cliente lo va a revisar. Te avisamos por este medio cualquier novedad.`;
}

/**
 * Añade la referencia Odoo al mensaje operativo.
 * Distingue NUEVO vs YA EXISTÍA — bug real 2026-08-06: el cliente no sabía si
 * Atilio acababa de generar el caso o si reutilizaba uno abierto.
 */
export function withOdooCaseAssignedSuffix(
  message: string,
  odooRef: string,
  opts?: { reused?: boolean },
): string {
  const display = formatCustomerOdooCaseRefForWhatsApp(odooRef);
  const base = message.trim().replace(/\s+$/, "");
  if (base.toLowerCase().includes(display.toLowerCase().replace(/^#/, "")) || base.includes(display)) {
    return base;
  }
  if (opts?.reused) {
    return `${base} Ese caso ya estaba abierto (*${display}*); no generé uno nuevo.`;
  }
  return `${base} Generé el caso *${display}* en Atención al cliente.`;
}

/** Si la IA/plantilla omitió el #Odoo, lo reinyecta con wording claro. */
export function ensureOdooCaseRefInClientMessage(
  message: string,
  odooRef: string | null | undefined,
  opts?: { reused?: boolean },
): string {
  const ref = normalizeCustomerOdooCaseRef(odooRef);
  if (!ref) return message.trim();
  const display = formatCustomerOdooCaseRefForWhatsApp(ref);
  const text = message.trim();
  if (!text) {
    return opts?.reused
      ? buildCustomerOdooCaseAssignedReply(ref, { reused: true })
      : buildCustomerOdooCaseAssignedReply(ref, { reused: false });
  }
  if (text.includes(display) || text.includes(ref)) return text;
  return withOdooCaseAssignedSuffix(text, ref, opts);
}
