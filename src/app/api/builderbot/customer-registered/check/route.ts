import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  acceptedCustomerContextSecretCount,
  customerRegisteredContextResponse,
  isCustomerContextAuthConfigured,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";

const bodySchema = z.object({
  phone: z.string().min(8),
  api_key: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
});

/**
 * POST /api/builderbot/customer-registered/check
 * Misma respuesta que GET …/:phone/context, pero la clave va en el JSON (útil si FlutterFlow
 * no envía headers custom en GET).
 *
 * Body: { "phone": "54911…", "api_key": "…" } o "apiKey".
 */
export async function POST(req: NextRequest) {
  if (!isCustomerContextAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          "Definí BUILDERBOT_CONTEXT_API_KEY (o API_KEY / N8N_API_KEY / BUILDERBOT_API_KEY) en Vercel.",
      },
      { status: 503 }
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Body inválido", details: parsed.error.flatten() }, { status: 400 });
  }

  const key = parsed.data.api_key ?? parsed.data.apiKey;
  if (!validateContextSecret(key)) {
    return NextResponse.json(
      {
        error: "API key inválida o faltante",
        receivedKey: !!key?.trim(),
        acceptedSecretsCount: acceptedCustomerContextSecretCount(),
        hint: "Enviá api_key en el JSON con el mismo valor que en Vercel (BUILDERBOT_CONTEXT_API_KEY, API_KEY, N8N_API_KEY o BUILDERBOT_API_KEY).",
      },
      { status: 401 }
    );
  }

  return customerRegisteredContextResponse(parsed.data.phone);
}
