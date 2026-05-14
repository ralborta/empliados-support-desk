import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findCustomerByWhatsAppNumber, normalizeWhatsAppPhone } from "@/lib/whatsappPhone";

/** Evita fallos por espacio final / BOM / CRLF al pegar en Vercel o en el cliente. */
function normalizeSecret(s: string): string {
  return s.replace(/^\uFEFF/, "").trim().replace(/\r\n/g, "\n").trim();
}

function acceptedSecrets(): string[] {
  /** Solo secretos “propios” del panel / n8n / FlutterFlow → Vercel. No mezclar con BUILDERBOT_API_KEY (eso es para la API de BuilderBot). */
  const raw = [process.env.BUILDERBOT_CONTEXT_API_KEY, process.env.API_KEY, process.env.N8N_API_KEY];
  return [
    ...new Set(
      raw
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => normalizeSecret(s))
    ),
  ];
}

export function validateContextSecret(provided: string | undefined | null): boolean {
  if (provided == null || !String(provided).trim()) return false;
  const p = normalizeSecret(String(provided));
  return acceptedSecrets().some((a) => a === p);
}

export function isCustomerContextAuthConfigured(): boolean {
  return acceptedSecrets().length > 0;
}

export function acceptedCustomerContextSecretCount(): number {
  return acceptedSecrets().length;
}

function getProvidedKey(req: NextRequest): string | undefined {
  const tryHeader = (name: string) => {
    const v = req.headers.get(name);
    return v?.trim() ? normalizeSecret(v) : undefined;
  };

  const h =
    tryHeader("x-api-key") ??
    tryHeader("x_api_key") ??
    tryHeader("apikey") ??
    tryHeader("pulze-api-key");
  if (h) return h;

  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const t = auth.slice(7).trim();
    if (t) return normalizeSecret(t);
  }

  for (const [k, v] of req.headers.entries()) {
    if (!v?.trim()) continue;
    const low = k.toLowerCase();
    if (/api[_-]?key|x[_-]?api[_-]?key/.test(low)) {
      return normalizeSecret(v);
    }
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("api_key") ?? searchParams.get("apiKey");
  if (q?.trim()) return normalizeSecret(q);

  return undefined;
}

/** Auth para BuilderBot / n8n (misma idea que Pulze `requireApiKey`). */
export function requireBuilderBotContextAuth(req: NextRequest): NextResponse | null {
  const accepted = acceptedSecrets();
  if (accepted.length === 0) {
    return NextResponse.json(
      {
        error:
          "Definí BUILDERBOT_CONTEXT_API_KEY (o API_KEY / N8N_API_KEY) en Vercel: es un secreto solo para llamar a este backend desde FlutterFlow/BuilderBot HTTP. No uses la misma clave que BUILDERBOT_API_KEY.",
      },
      { status: 503 }
    );
  }
  const provided = getProvidedKey(req);
  if (!validateContextSecret(provided)) {
    return NextResponse.json(
      {
        error: "API key inválida o faltante",
        receivedKey: !!provided,
        acceptedSecretsCount: accepted.length,
        hint: !provided
          ? "No llegó ninguna clave. Probá: query ?api_key= en la URL, header x-api-key, o POST /api/builderbot/customer-registered/check con JSON { phone, api_key } (FlutterFlow a veces no envía headers en GET)."
          : "La clave no coincide con BUILDERBOT_CONTEXT_API_KEY, API_KEY ni N8N_API_KEY en Vercel (revisá espacios al pegar). No es la clave bb-… de BuilderBot; creá una variable aparte y usá el mismo valor en FlutterFlow.",
      },
      { status: 401 }
    );
  }
  return null;
}

/**
 * JSON tipo Pulze GET …/users/:phone/context: registered, registered_s, phone normalizado.
 */
export async function customerRegisteredContextResponse(rawPhone: string): Promise<NextResponse> {
  const trimmed = rawPhone.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "Teléfono vacío" }, { status: 400 });
  }

  const normalized = normalizeWhatsAppPhone(trimmed) || trimmed.replace(/\D/g, "");
  if (normalized.length < 8) {
    return NextResponse.json({ error: "Teléfono inválido", received: trimmed }, { status: 400 });
  }

  const customer = await findCustomerByWhatsAppNumber(prisma, trimmed);
  const registered = !!customer;

  return NextResponse.json({
    registered,
    registered_s: registered ? "true" : "false",
    phone: normalized,
    name: customer?.name?.trim() || "",
    companyName: customer?.companyName?.trim() || "",
  });
}
