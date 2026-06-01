import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  isCustomerContextAuthConfigured,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";
import { registrarCambioOdometroHorometro, resolveWaraSessionByPhone } from "@/lib/waraApi";
import { normalizePlate } from "@/lib/wara";

const numericValue = z.union([z.number(), z.string()]).transform((value) => {
  const n = typeof value === "number" ? value : Number(value.replace(",", ".").trim());
  return Number.isFinite(n) ? n : Number.NaN;
});

const bodySchema = z
  .object({
    phone: z.string().min(8).optional(),
    from: z.string().min(8).optional(),
    patente: z.string().min(2).optional(),
    plate: z.string().min(2).optional(),
    fecha: z.string().min(1).optional(),
    date: z.string().min(1).optional(),
    odometro: numericValue.optional(),
    odometer: numericValue.optional(),
    horometro: numericValue.optional(),
    hourmeter: numericValue.optional(),
    api_key: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
    key: z.string().min(1).optional(),
    token: z.string().min(1).optional(),
  })
  .refine((d) => (d.phone ?? d.from ?? "").trim().length >= 8, {
    message: "Indicá phone o from con el número.",
  })
  .refine((d) => (d.patente ?? d.plate ?? "").trim().length >= 2, {
    message: "Indicá patente/plate.",
  })
  .refine((d) => {
    const odo = d.odometro ?? d.odometer;
    const horo = d.horometro ?? d.hourmeter;
    return (typeof odo === "number" && Number.isFinite(odo)) || (typeof horo === "number" && Number.isFinite(horo));
  }, "Debe enviar al menos odometro/odometer u horometro/hourmeter.");

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

function fechaUtc(value: string | undefined): string {
  if (!value?.trim()) return new Date().toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

/**
 * POST /api/wara/odometro-horometro
 *
 * Body:
 * {
 *   "phone": "5492613867127",
 *   "patente": "AA815XW",
 *   "odometro": 900000,
 *   "horometro": 6100,    // opcional
 *   "fecha": "2026-05-11T13:40:00Z", // opcional, default ahora
 *   "api_key": "..."      // o header x-api-key
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

  const patente = normalizePlate(parsed.data.patente ?? parsed.data.plate ?? "");
  const fecha = fechaUtc(parsed.data.fecha ?? parsed.data.date);
  if (!patente) {
    return NextResponse.json({ ok: false, error: "Patente inválida" }, { status: 400 });
  }
  if (!fecha) {
    return NextResponse.json({ ok: false, error: "Fecha inválida" }, { status: 400 });
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

  const odometro = parsed.data.odometro ?? parsed.data.odometer;
  const horometro = parsed.data.horometro ?? parsed.data.hourmeter;
  const result = await registrarCambioOdometroHorometro(session.sessionToken, {
    patente,
    fecha,
    ...(typeof odometro === "number" && Number.isFinite(odometro) ? { odometro } : {}),
    ...(typeof horometro === "number" && Number.isFinite(horometro) ? { horometro } : {}),
  });

  return NextResponse.json(
    {
      ...result,
      patente,
      fecha,
      companyName: session.companyName ?? "",
      contactName: session.contactName ?? "",
    },
    { status: result.ok ? 200 : result.status }
  );
}
