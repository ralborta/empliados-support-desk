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

/** Longitudes de los secretos activos (solo números; para ver si hubo truncado vs lo enviado). */
export function acceptedContextSecretLengths(): number[] {
  return [...new Set(acceptedSecrets().map((s) => s.length))].sort((a, b) => a - b);
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

/** Candidatos de clave en orden; se acepta el primero que coincida con Vercel. */
function collectContextKeyCandidates(req: NextRequest): string[] {
  const out: string[] = [];
  const push = (s: string | undefined) => {
    if (s == null || !String(s).trim()) return;
    const n = normalizeSecret(String(s));
    if (n && !out.includes(n)) out.push(n);
  };

  const tryHeader = (name: string) => {
    const v = req.headers.get(name);
    return v?.trim() ? normalizeSecret(v) : undefined;
  };

  const h =
    tryHeader("x-api-key") ??
    tryHeader("x_api_key") ??
    tryHeader("apikey") ??
    tryHeader("pulze-api-key");
  if (h) push(h);

  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const t = auth.slice(7).trim();
    if (t) push(t);
  }

  /**
   * Basic Auth: FlutterFlow / BuilderBot a veces parten un hex largo en
   * “usuario” (1 carácter) + “contraseña” (64) → solo la contraseña no matchea con Vercel (65).
   * Probamos contraseña, usuario+contraseña, y usuario.
   */
  if (auth?.toLowerCase().startsWith("basic ")) {
    const decoded = decodeBasicAuthPayload(auth.slice(6).trim());
    const colon = decoded.indexOf(":");
    if (colon >= 0) {
      const userPart = normalizeSecret(decoded.slice(0, colon));
      const passPart = normalizeSecret(decoded.slice(colon + 1));
      const combined = normalizeSecret(userPart + passPart);
      push(passPart);
      if (userPart && passPart && combined !== passPart) push(combined);
      push(userPart);
    } else if (decoded.trim()) {
      push(decoded);
    }
  }

  for (const [k, v] of req.headers.entries()) {
    if (!v?.trim()) continue;
    const low = k.toLowerCase();
    if (/api[_-]?key|x[_-]?api[_-]?key/.test(low)) {
      push(v);
    }
  }

  const { searchParams } = new URL(req.url);
  const q =
    searchParams.get("api_key") ??
    searchParams.get("apiKey") ??
    searchParams.get("key") ??
    searchParams.get("token");
  if (q?.trim()) push(q);

  return out;
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
  const candidates = collectContextKeyCandidates(req);
  if (candidates.some((c) => validateContextSecret(c))) {
    return null;
  }
  const receivedKey = candidates.length > 0;
  const longest = candidates.length
    ? candidates.reduce((a, b) => (a.length >= b.length ? a : b))
    : "";
  const providedLen = longest ? normalizedContextKeyLength(longest) : 0;
  const envNames = configuredContextSecretEnvNames();
  const multi =
    accepted.length > 1
      ? " Tenés varias claves distintas en Vercel; BuilderBot tiene que enviar exactamente el valor de UNA de ellas (carácter a carácter)."
      : "";
  const probe = contextAuthProbe(req);
  const configuredLengths = acceptedContextSecretLengths();
  const lengthMismatch = providedLen > 0 && !configuredLengths.includes(providedLen);
  const likelyPasswordTruncation =
    lengthMismatch && configuredLengths.some((l) => l === providedLen + 1);
  return NextResponse.json(
    {
      error: "API key inválida o faltante",
      receivedKey,
      acceptedSecretsCount: accepted.length,
      envVarsWithSecrets: envNames,
      providedKeyLength: providedLen,
      candidateKeyLengths: candidates.map((c) => c.length),
      configuredSecretLengths: configuredLengths,
      lengthMismatch,
      likelyPasswordFieldTruncation: likelyPasswordTruncation,
      authProbe: probe,
      hint: !receivedKey
        ? probe.authorizationShape === "basic"
          ? "Llegó Authorization: Basic sin una clave reconocible: poné el secreto de Vercel como contraseña (usuario vacío o cualquier valor), o usá header x-api-key / ?api_key= en la URL."
          : "No llegó clave usable. Como Pulze: header x-api-key = mismo texto que en Vercel. Alternativa: ?api_key=… en la URL, o POST …/api/builderbot/customer-registered/check con JSON."
        : lengthMismatch
          ? likelyPasswordTruncation
            ? `El servidor espera ${configuredLengths.join("/")} caracteres y el/los intento(s) llegan hasta ${providedLen} car. Típico: FlutterFlow limita la “contraseña” a 64; el 1er carácter a veces queda en “usuario” (ya probamos usuario+contraseña). Si sigue mal: x-api-key, ?api_key=, o secreto de 64 en Vercel (openssl rand -hex 32).`
            : `La clave que llega tiene ${providedLen} caracteres; en Vercel el secreto activo mide ${configuredLengths.join(" o ")}. Re-copiá el valor completo desde Settings → Environment.`
          : `La clave enviada no coincide (mismo largo ${providedLen} pero distinto contenido). Re-copiá BUILDERBOT_CONTEXT_API_KEY desde Vercel sin comillas.${multi}`,
    },
    { status: 401 }
  );
}

/**
 * True si el segmento de URL es un placeholder típico de BuilderBot sin sustituir
 * (llega literal en vez del número).
 */
export function isLikelyBuilderBotPhonePlaceholder(segment: string): boolean {
  const t = segment.trim();
  if (!t) return false;
  if (t.toLowerCase() === "{from}") return true;
  if (/^\{\{\s*@?from\s*\}\}$/i.test(t)) return true;
  if (/^\{\s*@?from\s*\}$/i.test(t)) return true;
  if (/^@from$/i.test(t)) return true;
  return false;
}

/**
 * Teléfono del path; si el path es placeholder y viene `?phone=` o `?from=`, usa el query.
 */
export function resolveContextPhoneFromRequest(req: NextRequest, pathSegment: string | undefined): string {
  const raw = decodeURIComponent(pathSegment ?? "").trim();
  if (isLikelyBuilderBotPhonePlaceholder(raw)) {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("phone") ?? searchParams.get("from") ?? "").trim();
    if (q) return q;
  }
  return raw;
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
    const placeholderHint = isLikelyBuilderBotPhonePlaceholder(trimmed)
      ? "El path llegó como texto literal (p. ej. {from}) sin reemplazar. En BuilderBot.cloud, en la URL del HTTP usá el asistente de variables para insertar el número del contacto (remitente), no escribas {from} a mano. Alternativas: GET …/customer-registered?phone=NUMERO&api_key=… o POST …/customer-registered/check con JSON \"from\"."
      : undefined;
    return NextResponse.json(
      {
        error: "Teléfono inválido",
        received: trimmed,
        ...(placeholderHint ? { hint: placeholderHint } : {}),
      },
      { status: 400 }
    );
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
