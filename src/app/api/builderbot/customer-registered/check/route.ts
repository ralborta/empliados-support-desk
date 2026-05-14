import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  acceptedContextSecretLengths,
  acceptedCustomerContextSecretCount,
  configuredContextSecretEnvNames,
  customerRegisteredContextResponse,
  isCustomerContextAuthConfigured,
  normalizedContextKeyLength,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";

const bodySchema = z
  .object({
    /** Número del contacto (FlutterFlow, etc.) */
    phone: z.string().min(8).optional(),
    /** Mismo dato que envía BuilderBot en webhooks (`data.from`) — podés mapear la variable {from} acá. */
    from: z.string().min(8).optional(),
    api_key: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
    key: z.string().min(1).optional(),
    token: z.string().min(1).optional(),
  })
  .refine((d) => {
    const p = (d.phone ?? d.from ?? "").trim();
    return p.length >= 8;
  }, "Indicá phone o from con el número (mín. 8 caracteres).");

/**
 * POST /api/builderbot/customer-registered/check
 * Misma respuesta que GET …/:phone/context, pero la clave va en el JSON (útil si FlutterFlow
 * no envía headers custom en GET).
 *
 * Body: { "phone": "54911…", "api_key": "…" } o usá "from" con el valor de BuilderBot {from}.
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
    return NextResponse.json({ error: "Body inválido", details: parsed.error.flatten() }, { status: 400 });
  }

  const rawPhone = (parsed.data.phone ?? parsed.data.from ?? "").trim();
  if (!rawPhone) {
    return NextResponse.json({ error: "Falta phone o from" }, { status: 400 });
  }

  const keyRaw = parsed.data.api_key ?? parsed.data.apiKey ?? parsed.data.key ?? parsed.data.token;
  if (!validateContextSecret(keyRaw)) {
    const accepted = acceptedCustomerContextSecretCount();
    const configuredLengths = acceptedContextSecretLengths();
    const providedLen = normalizedContextKeyLength(keyRaw);
    const lengthMismatch = providedLen > 0 && !configuredLengths.includes(providedLen);
    const multi =
      accepted > 1
        ? " Varias claves en Vercel: el body tiene que repetir exactamente UNA de ellas."
        : "";
    return NextResponse.json(
      {
        error: "API key inválida o faltante",
        receivedKey: !!keyRaw?.trim(),
        acceptedSecretsCount: accepted,
        envVarsWithSecrets: configuredContextSecretEnvNames(),
        providedKeyLength: providedLen,
        configuredSecretLengths: configuredLengths,
        lengthMismatch,
        hint: !keyRaw?.trim()
          ? "Falta api_key (o key / token) en el JSON con el mismo texto que en Vercel."
          : lengthMismatch
            ? `La clave en el JSON tiene ${providedLen} caracteres; en Vercel el secreto mide ${configuredLengths.join(" o ")}. Re-copiá el valor completo.`
            : `La clave del JSON no coincide (mismo largo ${providedLen}, contenido distinto).${multi} No uses BUILDERBOT_API_KEY (bb-…).`,
      },
      { status: 401 }
    );
  }

  return customerRegisteredContextResponse(rawPhone);
}
