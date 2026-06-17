import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  requireBuilderBotContextAuth,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";
import { obtenerEmpresaPorNumero, selectCompanyForCustomer } from "@/lib/waraApi";
import { findCustomerByWhatsAppNumber, normalizeWhatsAppPhone } from "@/lib/whatsappPhone";

/** BuilderBot solo interpola {message} y reglas HTTP cuando el status es 2xx. */
const BB_STATUS = 200;

const bodySchema = z
  .object({
    phone: z.string().min(8).optional(),
    from: z.string().min(8).optional(),
    companyName: z.string().min(1).optional(),
    company: z.string().min(1).optional(),
    waraContactId: z.union([z.number(), z.string()]).optional(),
    contactId: z.union([z.number(), z.string()]).optional(),
    reset: z.union([z.boolean(), z.string()]).optional(),
    api_key: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
    key: z.string().min(1).optional(),
    token: z.string().min(1).optional(),
  })
  .refine((d) => {
    const p = (d.phone ?? d.from ?? "").trim();
    return p.length >= 8;
  }, "Indicá phone o from con el número (mín. 8 caracteres).")
  .refine(
    (d) =>
      isResetFlag(d.reset) ||
      isChangeCompanyPhrase(d.companyName ?? d.company) ||
      Boolean(
        (d.companyName ?? d.company ?? "").trim() ||
          d.waraContactId != null ||
          d.contactId != null
      ),
    "Indicá companyName/company o waraContactId/contactId."
  );

function isResetFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") {
    return ["1", "true", "reset", "si", "sí", "yes"].includes(value.trim().toLowerCase());
  }
  return false;
}

/** Detecta frases del cliente para volver a elegir empresa (ej. "cambiar empresa"). */
function isChangeCompanyPhrase(value: string | undefined | null): boolean {
  const t = (value ?? "").trim().toLowerCase();
  if (!t) return false;
  return /\b(cambiar|cambio|cambiá|otra|elegir|seleccionar)\b.*\bempresa\b|\bempresa\b.*\b(cambiar|equivocada|otra)\b|^cambiar empresa$/.test(
    t
  );
}

function toContactId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * POST /api/builderbot/customer-registered/select-company
 *
 * Persiste la empresa elegida por el cliente cuando Wara devolvió varias.
 * BuilderBot lo llama después del menú "¿De cuál empresa escribís?".
 *
 * Body:
 * {
 *   "phone": "5492611234567",        // o "from": "{from}"
 *   "companyName": "EDEMSA",         // y/o "waraContactId": 1234
 *   "api_key": "..."                 // mismo secreto que el endpoint /check
 * }
 */
export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, ok_s: "false", error: "Body inválido", details: parsed.error.flatten() },
      { status: BB_STATUS }
    );
  }

  // BuilderBot manda el secreto en el header x-api-key (igual que /check).
  // Aceptamos también api_key en el body por compatibilidad.
  const bodyKey =
    parsed.data.api_key ?? parsed.data.apiKey ?? parsed.data.key ?? parsed.data.token;
  if (!validateContextSecret(bodyKey)) {
    const authError = requireBuilderBotContextAuth(req);
    if (authError) return authError;
  }

  const rawPhone = (parsed.data.phone ?? parsed.data.from ?? "").trim();
  const companyName = (
    parsed.data.companyName ??
    parsed.data.company ??
    (parsed.data as { body?: string; rawText?: string; selection?: string }).body ??
    (parsed.data as { rawText?: string }).rawText ??
    (parsed.data as { selection?: string }).selection ??
    ""
  ).trim();
  const waraContactId = toContactId(parsed.data.waraContactId ?? parsed.data.contactId);

  // Modo "cambiar empresa": limpia la empresa guardada y devuelve el menú de opciones.
  if (isResetFlag(parsed.data.reset) || isChangeCompanyPhrase(companyName)) {
    const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
    if (customer) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: { companyName: "" },
      });
    }
    const lookup = await obtenerEmpresaPorNumero(rawPhone);
    const contacts = lookup.contactos ?? [];
    const waraContactsText = contacts
      .map((c, i) => `${i + 1}. ${c.empresa || c.nombre}`)
      .join("\n");
    const multi = contacts.length > 1;
    const message = multi
      ? `Listo, reinicié la empresa. ¿Con cuál seguimos?\n\n${waraContactsText}\n\nRespondé con el número de la opción o el nombre de la empresa.`
      : contacts.length === 1
        ? `Tu número tiene una sola empresa asociada (${contacts[0].empresa || contacts[0].nombre}), así que sigo con esa. ¿En qué te puedo ayudar?`
        : `No encontré empresas asociadas a tu número en Wara. Te derivo con un agente.`;
    return NextResponse.json(
      {
        ok: true,
        ok_s: "true",
        reset: true,
        reset_s: "true",
        requiresCompanySelection: multi,
        requiresCompanySelection_s: multi ? "true" : "false",
        phone: normalizeWhatsAppPhone(rawPhone),
        companyName: "",
        waraContactsText,
        contacts,
        message,
      },
      { status: BB_STATUS }
    );
  }

  const result = await selectCompanyForCustomer(prisma, rawPhone, {
    companyName: companyName || undefined,
    waraContactId,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        ok_s: "false",
        error: result.error,
        contacts: result.contacts ?? [],
        message: result.menuMessage ?? result.error,
        requiresCompanySelection: true,
        requiresCompanySelection_s: "true",
      },
      { status: BB_STATUS }
    );
  }

  const customer = result.customer;
  const selectedCompany = customer?.companyName?.trim() || "";
  // Mensaje de cierre del paso "elegir empresa": confirma y vuelve a abrir el turno.
  // El próximo mensaje del cliente entra de nuevo por Inicio -> Router con la empresa
  // ya fijada, así no encadenamos un clasificador de intención sobre la opción ("1"/"2").
  const message =
    `Perfecto, sigo con ${selectedCompany || "tu empresa"}. ¿En qué te puedo ayudar?\n\n` +
    `Puedo: consultar el estado de una unidad, registrar un cambio de odómetro/horómetro, ` +
    `gestionar mantenimiento o solicitar un certificado.`;
  return NextResponse.json({
    ok: true,
    ok_s: "true",
    phone: normalizeWhatsAppPhone(rawPhone),
    companyName: selectedCompany,
    waraContactId: result.matchedContact?.id ?? null,
    contacts: result.contacts ?? [],
    message,
    requiresCompanySelection: false,
    requiresCompanySelection_s: "false",
  }, { status: BB_STATUS });
}
