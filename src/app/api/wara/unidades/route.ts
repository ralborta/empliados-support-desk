import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  isCustomerContextAuthConfigured,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";
import { consultarEstadoUnidades, resolveWaraSessionByPhone } from "@/lib/waraApi";

const bodySchema = z
  .object({
    phone: z.string().min(8).optional(),
    from: z.string().min(8).optional(),
    unidad: z.union([z.number(), z.string(), z.array(z.union([z.number(), z.string()]))]).optional(),
    unidades: z.array(z.union([z.number(), z.string()])).optional(),
    api_key: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
    key: z.string().min(1).optional(),
    token: z.string().min(1).optional(),
  })
  .refine((d) => (d.phone ?? d.from ?? "").trim().length >= 8, {
    message: "Indicá phone o from con el número.",
  });

function keyFromRequest(req: NextRequest, body: z.infer<typeof bodySchema>): string | undefined {
  return (
    req.headers.get("x-api-key")?.trim() ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    body.api_key ||
    body.apiKey ||
    body.key ||
    body.token
  );
}

function parseUnitIds(body: z.infer<typeof bodySchema>): number[] {
  const raw = body.unidades ?? (Array.isArray(body.unidad) ? body.unidad : body.unidad != null ? [body.unidad] : []);
  return raw
    .map((value) => (typeof value === "number" ? value : Number(value.trim())))
    .filter((value) => Number.isFinite(value));
}

/**
 * POST /api/wara/unidades
 *
 * Body:
 * {
 *   "phone": "5492613867127",
 *   "unidad": [],        // opcional; IDs movil_id a filtrar
 *   "api_key": "..."     // o header x-api-key
 * }
 */
export async function POST(req: NextRequest) {
  if (!isCustomerContextAuthConfigured()) {
    return NextResponse.json(
      { ok: false, error: "BUILDERBOT_CONTEXT_API_KEY/PULZE_API_KEY no configurado" },
      { status: 503 }
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Body inválido", details: parsed.error.flatten() }, { status: 400 });
  }

  if (!validateContextSecret(keyFromRequest(req, parsed.data))) {
    return NextResponse.json({ ok: false, error: "API key inválida o faltante" }, { status: 401 });
  }

  const rawPhone = (parsed.data.phone ?? parsed.data.from ?? "").trim();
  const session = await resolveWaraSessionByPhone(prisma, rawPhone);
  if (!session.ok || !session.sessionToken) {
    return NextResponse.json(
      {
        ok: false,
        error: session.error,
        requiresCompanySelection: session.requiresCompanySelection ?? false,
        testBlocked: session.testBlocked ?? false,
      },
      { status: session.status }
    );
  }

  const result = await consultarEstadoUnidades(session.sessionToken, parseUnitIds(parsed.data));
  return NextResponse.json(
    {
      ...result,
      companyName: session.companyName ?? result.cliente ?? "",
      contactName: session.contactName ?? "",
      unidadesCount: result.unidades.length,
    },
    { status: result.ok ? 200 : result.status }
  );
}
