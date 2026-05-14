import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findCustomerByWhatsAppNumber, normalizeWhatsAppPhone } from "@/lib/whatsappPhone";

function acceptedSecrets(): string[] {
  const raw = [
    process.env.BUILDERBOT_CONTEXT_API_KEY,
    process.env.API_KEY,
    process.env.N8N_API_KEY,
    /** Misma clave que ya usás para mensajes BuilderBot en Vercel (opcional, para no duplicar secretos). */
    process.env.BUILDERBOT_API_KEY,
  ];
  return [
    ...new Set(
      raw
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim())
    ),
  ];
}

function getProvidedKey(req: NextRequest): string | undefined {
  const h =
    req.headers.get("x-api-key") ??
    req.headers.get("X-API-Key") ??
    req.headers.get("x_api_key") ??
    req.headers.get("X_API_KEY") ??
    req.headers.get("apikey") ??
    req.headers.get("pulze-api-key");
  if (h?.trim()) return h.trim();
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("api_key") ?? searchParams.get("apiKey");
  if (q?.trim()) return q.trim();
  return undefined;
}

/** Auth para BuilderBot / n8n (misma idea que Pulze `requireApiKey`). */
export function requireBuilderBotContextAuth(req: NextRequest): NextResponse | null {
  const accepted = acceptedSecrets();
  if (accepted.length === 0) {
    return NextResponse.json(
      {
        error:
          "Definí BUILDERBOT_CONTEXT_API_KEY (o API_KEY / N8N_API_KEY / BUILDERBOT_API_KEY) en el servidor para esta consulta desde BuilderBot.",
      },
      { status: 503 }
    );
  }
  const provided = getProvidedKey(req);
  if (!provided || !accepted.includes(provided)) {
    return NextResponse.json(
      {
        error: "API key inválida o faltante",
        hint: !provided
          ? "No llegó ninguna clave. En GET: header x-api-key o x_api_key, Authorization: Bearer …, o query ?api_key= (mismo valor que en Vercel: BUILDERBOT_CONTEXT_API_KEY, API_KEY, N8N_API_KEY o BUILDERBOT_API_KEY)."
          : "La clave enviada no coincide con ninguna de las variables en Vercel. Revisá que sea exactamente la misma (sin espacios de más), que FlutterFlow envíe el header en esta petición GET y que hayas hecho redeploy tras cambiar env.",
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
