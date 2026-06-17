import { NextRequest, NextResponse } from "next/server";
import {
  customerRegisteredContextResponse,
  requireBuilderBotContextAuth,
  resolveContextPhoneFromRequest,
} from "@/lib/builderbotCustomerContext";

/**
 * GET /api/builderbot/customer-registered/:phone/context
 * Misma respuesta que GET /api/bot/users/:phone/context (patrón Pulze); esta ruta queda por compatibilidad.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ phone: string }> }
) {
  const denied = requireBuilderBotContextAuth(req);
  if (denied) return denied;

  const { phone: phoneSegment } = await params;
  const raw = resolveContextPhoneFromRequest(req, phoneSegment);
  if (!raw) {
    return NextResponse.json({ error: "Falta teléfono en la URL" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const selectionText = (
    searchParams.get("selection") ??
    searchParams.get("body") ??
    searchParams.get("message") ??
    ""
  ).trim();

  return customerRegisteredContextResponse(raw, {
    selectionText: selectionText || undefined,
  });
}
