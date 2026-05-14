import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findCustomerByWhatsAppNumber, normalizeWhatsAppPhone } from "@/lib/whatsappPhone";

/** Evita fallos por espacio final / BOM / CRLF / caracteres invisibles (Slack, Notion, Vercel). */
function normalizeSecret(s: string): string {
  let t = String(s ?? "");
  t = t.replace(/^\uFEFF/, "");
  t = t.replace(/[\u200B-\u200D\uFEFF\u2060]/g, "");
  t = t.replace(/\u00A0/g, " ");
  return t.trim().replace(/\r\n/g, "\n").trim();
}

function acceptedSecrets(): string[] {
  /**
   * Secreto compartido Empliados ↔ BuilderBot / n8n (como Pulze con x-api-key).
   * No usar BUILDERBOT_API_KEY (bb-…): eso es solo para la API de BuilderBot.cloud.
   */
  const raw = [
    process.env.PULZE_API_KEY,
    process.env.BUILDERBOT_CONTEXT_API_KEY,
    process.env.API_KEY,
    process.env.N8N_API_KEY,
  ];
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

/** Longitud del secreto normalizado (solo diagnóstico, sin exponer el valor). */
export function normalizedContextKeyLength(raw: string | undefined | null): number {
  if (raw == null || !String(raw).trim()) return 0;
  return normalizeSecret(String(raw)).length;
}

export function isCustomerContextAuthConfigured(): boolean {
  return acceptedSecrets().length > 0;
}

export function acceptedCustomerContextSecretCount(): number {
  return acceptedSecrets().length;
}

/** Nombres de env que tienen secreto (no expone valores). Para depurar 401. */
export function configuredContextSecretEnvNames(): string[] {
  const n: string[] = [];
  if (process.env.PULZE_API_KEY?.trim()) n.push("PULZE_API_KEY");
  if (process.env.BUILDERBOT_CONTEXT_API_KEY?.trim()) n.push("BUILDERBOT_CONTEXT_API_KEY");
  if (process.env.API_KEY?.trim()) n.push("API_KEY");
  if (process.env.N8N_API_KEY?.trim()) n.push("N8N_API_KEY");
  return n;
}

function decodeBasicAuthPayload(b64: string): string {
  try {
    const clean = b64.replace(/\s/g, "");
    const raw = atob(clean);
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
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

  /** FlutterFlow / BuilderBot a veces mandan la clave como “usuario y contraseña” (Basic Auth). */
  if (auth?.toLowerCase().startsWith("basic ")) {
    const decoded = decodeBasicAuthPayload(auth.slice(6).trim());
    const colon = decoded.indexOf(":");
    if (colon >= 0) {
      const userPart = normalizeSecret(decoded.slice(0, colon));
      const passPart = normalizeSecret(decoded.slice(colon + 1));
      if (passPart) return passPart;
      if (userPart) return userPart;
    } else if (decoded.trim()) {
      return normalizeSecret(decoded);
    }
  }

  for (const [k, v] of req.headers.entries()) {
    if (!v?.trim()) continue;
    const low = k.toLowerCase();
    if (/api[_-]?key|x[_-]?api[_-]?key/.test(low)) {
      return normalizeSecret(v);
    }
  }

  const { searchParams } = new URL(req.url);
  const q =
    searchParams.get("api_key") ??
    searchParams.get("apiKey") ??
    searchParams.get("key") ??
    searchParams.get("token");
  if (q?.trim()) return normalizeSecret(q);

  return undefined;
}

/** Sin secretos: para ver si el cliente manda Basic vs x-api-key vs query. */
function contextAuthProbe(req: NextRequest): {
  authorizationShape: "none" | "bearer" | "basic" | "other";
  hasHeaderXApiKey: boolean;
  hasQueryApiKey: boolean;
} {
  const auth = req.headers.get("authorization");
  let authorizationShape: "none" | "bearer" | "basic" | "other" = "none";
  if (auth?.trim()) {
    const l = auth.toLowerCase();
    if (l.startsWith("bearer ")) authorizationShape = "bearer";
    else if (l.startsWith("basic ")) authorizationShape = "basic";
    else authorizationShape = "other";
  }
  const url = new URL(req.url);
  const hasQueryApiKey = !!(
    url.searchParams.get("api_key")?.trim() ||
    url.searchParams.get("apiKey")?.trim() ||
    url.searchParams.get("key")?.trim() ||
    url.searchParams.get("token")?.trim()
  );
  return {
    authorizationShape,
    hasHeaderXApiKey: !!req.headers.get("x-api-key")?.trim(),
    hasQueryApiKey,
  };
}

/** Auth para BuilderBot / n8n (misma idea que Pulze `requireApiKey`). */
export function requireBuilderBotContextAuth(req: NextRequest): NextResponse | null {
  const accepted = acceptedSecrets();
  if (accepted.length === 0) {
    return NextResponse.json(
      {
        error:
          "Definí PULZE_API_KEY o BUILDERBOT_CONTEXT_API_KEY en Vercel (un secreto largo, tipo Pulze). No uses BUILDERBOT_API_KEY (bb-…).",
        envVarsWithSecrets: configuredContextSecretEnvNames(),
      },
      { status: 503 }
    );
  }
  const provided = getProvidedKey(req);
  if (!validateContextSecret(provided)) {
    const envNames = configuredContextSecretEnvNames();
    const multi =
      accepted.length > 1
        ? " Tenés varias claves distintas en Vercel; BuilderBot tiene que enviar exactamente el valor de UNA de ellas (carácter a carácter)."
        : "";
    const probe = contextAuthProbe(req);
    return NextResponse.json(
      {
        error: "API key inválida o faltante",
        receivedKey: !!provided,
        acceptedSecretsCount: accepted.length,
        envVarsWithSecrets: envNames,
        providedKeyLength: normalizedContextKeyLength(provided ?? ""),
        authProbe: probe,
        hint: !provided
          ? probe.authorizationShape === "basic"
            ? "Llegó Authorization: Basic sin una clave reconocible: poné el secreto de Vercel como contraseña (usuario vacío o cualquier valor), o usá header x-api-key / ?api_key= en la URL."
            : "No llegó clave usable. Como Pulze: header x-api-key = mismo texto que en Vercel. Alternativa: ?api_key=… en la URL, o POST …/api/builderbot/customer-registered/check con JSON."
          : `La clave enviada no coincide con ninguna variable activa.${multi} Re-copiá desde Vercel (sin comillas ni espacio al final).`,
      },
      { status: 401 }
    );
  }
  return null;
}

/**
 * JSON tipo Pulze GET /api/bot/users/:phone/context: registered, registered_s, phone normalizado.
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
