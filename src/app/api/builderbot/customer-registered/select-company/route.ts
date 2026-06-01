import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  acceptedContextSecretLengths,
  acceptedCustomerContextSecretCount,
  configuredContextSecretEnvNames,
  isCustomerContextAuthConfigured,
  normalizedContextKeyLength,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";
import { selectCompanyForCustomer } from "@/lib/waraApi";
import { normalizeWhatsAppPhone } from "@/lib/whatsappPhone";

const bodySchema = z
  .object({
    phone: z.string().min(8).optional(),
    from: z.string().min(8).optional(),
    companyName: z.string().min(1).optional(),
    company: z.string().min(1).optional(),
    waraContactId: z.union([z.number(), z.string()]).optional(),
    contactId: z.union([z.number(), z.string()]).optional(),
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
      Boolean(
        (d.companyName ?? d.company ?? "").trim() ||
          d.waraContactId != null ||
          d.contactId != null
      ),
    "Indicá companyName/company o waraContactId/contactId."
  );

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
  if (!isCustomerContextAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          "Definí PULZE_API_KEY o BUILDERBOT_CONTEXT_API_KEY en Vercel. Es distinta de BUILDERBOT_API_KEY.",
        envVarsWithSecrets: configuredContextSecretEnvNames(),
      },
      { status: 503 }
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const keyRaw =
    parsed.data.api_key ?? parsed.data.apiKey ?? parsed.data.key ?? parsed.data.token;
  if (!validateContextSecret(keyRaw)) {
    const accepted = acceptedCustomerContextSecretCount();
    const configuredLengths = acceptedContextSecretLengths();
    const providedLen = normalizedContextKeyLength(keyRaw);
    return NextResponse.json(
      {
        error: "API key inválida o faltante",
        receivedKey: !!keyRaw?.trim(),
        acceptedSecretsCount: accepted,
        envVarsWithSecrets: configuredContextSecretEnvNames(),
        providedKeyLength: providedLen,
        configuredSecretLengths: configuredLengths,
        hint: "Enviá api_key con el mismo valor que PULZE_API_KEY o BUILDERBOT_CONTEXT_API_KEY en Vercel.",
      },
      { status: 401 }
    );
  }

  const rawPhone = (parsed.data.phone ?? parsed.data.from ?? "").trim();
  const companyName = (parsed.data.companyName ?? parsed.data.company ?? "").trim();
  const waraContactId = toContactId(parsed.data.waraContactId ?? parsed.data.contactId);

  const result = await selectCompanyForCustomer(prisma, rawPhone, {
    companyName: companyName || undefined,
    waraContactId,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        contacts: result.contacts ?? [],
      },
      { status: result.status }
    );
  }

  const customer = result.customer;
  return NextResponse.json({
    ok: true,
    phone: normalizeWhatsAppPhone(rawPhone),
    companyName: customer?.companyName?.trim() || "",
    waraContactId: result.matchedContact?.id ?? null,
    contacts: result.contacts ?? [],
  });
}
