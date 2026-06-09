import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBuilderBotContextAuth } from "@/lib/builderbotCustomerContext";
import {
  createHelpdeskTicket,
  getOdooConfig,
  getOdooConfigStatus,
  OdooError,
} from "@/lib/odooApi";

/**
 * Crea un ticket de reclamo en Odoo Helpdesk.
 * POST /api/odoo/ticket  (con x-api-key del contexto)
 *
 * Body:
 * {
 *   "subject": "AA123CB - No reporta",          // o "title"; también puede armarse con plate + event
 *   "plate": "AA123CB",
 *   "event": "No reporta",
 *   "description": "Detalle del reclamo...",
 *   "customerName": "Raúl Alborta",
 *   "companyName": "El Cacique S.A.",
 *   "customerPhone": "+5491133788190",
 *   "customerEmail": "...",                     // opcional
 *   "teamId": 33,                                // opcional, sobrescribe ODOO_HELPDESK_TEAM_ID
 *   "stageId": 12                                // opcional, sobrescribe ODOO_HELPDESK_STAGE_ID
 * }
 */
const bodySchema = z
  .object({
    subject: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    plate: z.string().optional(),
    patente: z.string().optional(),
    event: z.string().optional(),
    evento: z.string().optional(),
    description: z.string().optional(),
    aiSummary: z.string().optional(),
    customerName: z.string().optional(),
    companyName: z.string().optional(),
    customerEmail: z.string().optional(),
    customerPhone: z.string().optional(),
    priority: z.string().optional(),
    teamId: z.union([z.number(), z.string()]).optional(),
    stageId: z.union([z.number(), z.string()]).optional(),
  })
  .refine(
    (d) => Boolean((d.subject ?? d.title ?? "").trim() || (d.plate ?? d.patente ?? "").trim()),
    "Indicá subject/title o plate/patente."
  );

function toNumberId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value.trim());
  }
  return undefined;
}

function normalizePlateForTitle(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, "").trim().toUpperCase();
}

function buildSubject(data: z.infer<typeof bodySchema>): string {
  const explicit = (data.subject ?? data.title ?? "").trim();
  if (explicit) return explicit;
  const plate = normalizePlateForTitle(data.plate ?? data.patente);
  const event = (data.event ?? data.evento ?? "Consulta/reclamo").trim();
  return plate ? `${plate} - ${event}` : event;
}

function buildDescription(data: z.infer<typeof bodySchema>): string {
  const lines = [
    data.description?.trim(),
    data.aiSummary?.trim(),
    data.companyName?.trim() ? `Empresa Wara: ${data.companyName.trim()}` : "",
    normalizePlateForTitle(data.plate ?? data.patente)
      ? `Patente: ${normalizePlateForTitle(data.plate ?? data.patente)}`
      : "",
    (data.event ?? data.evento ?? "").trim() ? `Evento: ${(data.event ?? data.evento ?? "").trim()}` : "",
    data.customerName?.trim() ? `Contacto: ${data.customerName.trim()}` : "",
    data.customerPhone?.trim() ? `WhatsApp: ${data.customerPhone.trim()}` : "",
    "Origen: Atilio / WhatsApp",
  ];
  return lines.filter(Boolean).join("\n");
}

export async function POST(req: NextRequest) {
  const authError = requireBuilderBotContextAuth(req);
  if (authError) return authError;

  const cfg = getOdooConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        ok: false,
        error: "Odoo no configurado",
        message: "Faltan variables de entorno de Odoo.",
        missing: getOdooConfigStatus().missing,
      },
      { status: 503 }
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Body inválido", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const subject = buildSubject(parsed.data);
  const description = buildDescription(parsed.data);

  try {
    const result = await createHelpdeskTicket(cfg, {
      subject,
      description,
      customerName: parsed.data.customerName,
      companyName: parsed.data.companyName,
      customerEmail: parsed.data.customerEmail,
      customerPhone: parsed.data.customerPhone,
      priority: parsed.data.priority,
      teamId: toNumberId(parsed.data.teamId),
      stageId: toNumberId(parsed.data.stageId),
    });
    return NextResponse.json({
      ok: true,
      ticketId: result.ticketId,
      ref: result.ref,
      url: result.url,
      message: `Reclamo registrado en Odoo. Ticket ${result.ref ?? result.ticketId}.`,
    });
  } catch (e) {
    const message = e instanceof OdooError ? e.message : "Error inesperado creando el ticket en Odoo.";
    return NextResponse.json(
      { ok: false, error: "Error de Odoo", message, detail: e instanceof OdooError ? e.detail : String(e) },
      { status: 502 }
    );
  }
}
