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
 *   "subject": "Reclamo: unidad no reporta",   // o "title"
 *   "description": "Detalle del reclamo...",
 *   "customerName": "Raúl Alborta",
 *   "customerPhone": "+5491133788190",
 *   "customerEmail": "...",                     // opcional
 *   "priority": "HIGH",                          // LOW | NORMAL | HIGH | URGENT
 *   "teamId": 33                                 // opcional, sobrescribe ODOO_HELPDESK_TEAM_ID
 * }
 */
const bodySchema = z
  .object({
    subject: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    customerName: z.string().optional(),
    customerEmail: z.string().optional(),
    customerPhone: z.string().optional(),
    priority: z.string().optional(),
    teamId: z.union([z.number(), z.string()]).optional(),
  })
  .refine((d) => Boolean((d.subject ?? d.title ?? "").trim()), "Indicá subject (asunto del reclamo).");

function toTeamId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value.trim());
  }
  return undefined;
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

  const subject = (parsed.data.subject ?? parsed.data.title ?? "").trim();

  try {
    const result = await createHelpdeskTicket(cfg, {
      subject,
      description: parsed.data.description,
      customerName: parsed.data.customerName,
      customerEmail: parsed.data.customerEmail,
      customerPhone: parsed.data.customerPhone,
      priority: parsed.data.priority,
      teamId: toTeamId(parsed.data.teamId),
    });
    return NextResponse.json({
      ok: true,
      ticketId: result.ticketId,
      ref: result.ref,
      url: result.url,
      message: `Reclamo registrado en Odoo${result.ref ? ` (${result.ref})` : ""}.`,
    });
  } catch (e) {
    const message = e instanceof OdooError ? e.message : "Error inesperado creando el ticket en Odoo.";
    return NextResponse.json(
      { ok: false, error: "Error de Odoo", message, detail: e instanceof OdooError ? e.detail : String(e) },
      { status: 502 }
    );
  }
}
