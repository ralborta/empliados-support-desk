import { NextRequest, NextResponse } from "next/server";
import {
  customerRegisteredContextResponse,
  requireBuilderBotContextAuth,
} from "@/lib/builderbotCustomerContext";

/**
 * GET /api/builderbot/customer-registered?phone=54911…
 * Alternativa al path …/:phone/context (misma respuesta).
 */
export async function GET(req: NextRequest) {
  const denied = requireBuilderBotContextAuth(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("phone") ?? "").trim();
  if (!raw) {
    return NextResponse.json(
      {
        error:
          "Falta query phone. Preferí GET /api/bot/users/{telefono}/context (como Pulze) o …/customer-registered/{tel}/context.",
      },
      { status: 400 }
    );
  }

  return customerRegisteredContextResponse(raw);
}
