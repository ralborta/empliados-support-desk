import { NextRequest, NextResponse } from "next/server";
import {
  customerRegisteredContextResponse,
  requireBuilderBotContextAuth,
} from "@/lib/builderbotCustomerContext";

/**
 * GET /api/builderbot/customer-registered/:phone/context
 * Misma forma que Pulze: GET /api/bot/users/:phone/context — ideal para BuilderBot
 * (URL con @from o número sustituido en el path).
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
