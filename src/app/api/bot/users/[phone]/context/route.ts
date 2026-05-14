import { NextRequest, NextResponse } from "next/server";
import {
  customerRegisteredContextResponse,
  requireBuilderBotContextAuth,
} from "@/lib/builderbotCustomerContext";

/**
 * Mismo contrato que Pulze en BuilderBot.cloud:
 * GET /api/bot/users/:phone/context
 *
 * - Teléfono (o JID tipo 549...@c.us) en el path; BuilderBot suele sustituir `@from` acá.
 * - Auth: header `x-api-key` con el valor de `PULZE_API_KEY` o `BUILDERBOT_CONTEXT_API_KEY` en Vercel.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ phone: string }> }
) {
  const denied = requireBuilderBotContextAuth(req);
  if (denied) return denied;

  const { phone: phoneSegment } = await params;
  const raw = decodeURIComponent(phoneSegment ?? "").trim();
  if (!raw) {
    return NextResponse.json({ error: "Falta teléfono en la URL" }, { status: 400 });
  }

  return customerRegisteredContextResponse(raw);
}
