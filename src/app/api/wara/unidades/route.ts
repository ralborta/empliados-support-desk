import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  isCustomerContextAuthConfigured,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";
import { normalizePlate } from "@/lib/wara";
import { consultarEstadoUnidades, resolveWaraSessionByPhone, type WaraUnidadEstado } from "@/lib/waraApi";

const bodySchema = z
  .object({
    phone: z.string().min(8).optional(),
    from: z.string().min(8).optional(),
    patente: z.string().min(2).optional(),
    plate: z.string().min(2).optional(),
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

function minutesAgo(seconds: number | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "sin dato";
  if (seconds < 90) return "menos de 2 minutos";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minutos`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} horas`;
  return `${Math.round(hours / 24)} días`;
}

function summarizeUnit(unit: WaraUnidadEstado): string {
  const ign = unit.ultima_ignicion?.estado === true ? "encendida" : unit.ultima_ignicion?.estado === false ? "apagada" : "sin dato";
  const volt = typeof unit.alimentacion_externa?.voltaje === "number" ? `${unit.alimentacion_externa.voltaje}V` : "sin dato";
  return `Unidad ${unit.patente || unit.unidad}: último reporte hace ${minutesAgo(unit.ultimo_reporte?.hace_segundos)}, ignición ${ign}, alimentación ${volt}.`;
}

function normalizeLoosePlate(value: string): string {
  return normalizePlate(value)?.replace(/\s+/g, "") ?? "";
}

export async function POST(req: NextRequest) {
  if (!isCustomerContextAuthConfigured()) {
    return NextResponse.json(
      { ok: false, error: "BUILDERBOT_CONTEXT_API_KEY/PULZE_API_KEY no configurado", summaryText: "No pude autenticar la consulta interna." },
      { status: 503 }
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Body inválido", summaryText: "Faltan datos para consultar la unidad.", details: parsed.error.flatten() }, { status: 400 });
  }

  if (!validateContextSecret(keyFromRequest(req, parsed.data))) {
    return NextResponse.json({ ok: false, error: "API key inválida o faltante", summaryText: "No pude autenticar la consulta interna." }, { status: 401 });
  }

  const rawPhone = (parsed.data.phone ?? parsed.data.from ?? "").trim();
  const session = await resolveWaraSessionByPhone(prisma, rawPhone);
  if (!session.ok || !session.sessionToken) {
    return NextResponse.json(
      {
        ok: false,
        error: session.error,
        summaryText: session.requiresCompanySelection
          ? "Antes de consultar unidades necesito que elijas la empresa asociada a este número."
          : "No pude consultar las unidades en Wara. Te derivo con un agente para revisarlo.",
        requiresCompanySelection: session.requiresCompanySelection ?? false,
        testBlocked: session.testBlocked ?? false,
      },
      { status: session.status }
    );
  }

  const result = await consultarEstadoUnidades(session.sessionToken, parseUnitIds(parsed.data));
  const wantedPlate = normalizeLoosePlate(parsed.data.patente ?? parsed.data.plate ?? "");
  const filtered = wantedPlate
    ? result.unidades.filter((u) => normalizeLoosePlate(u.patente).includes(wantedPlate) || wantedPlate.includes(normalizeLoosePlate(u.patente)))
    : result.unidades;
  const summaryText = !result.ok
    ? result.error || "No pude consultar las unidades en Wara."
    : filtered.length === 0
      ? `No encontré una unidad con esa patente para ${session.companyName || result.cliente || "este cliente"}.`
      : filtered.length === 1
        ? summarizeUnit(filtered[0])
        : `Encontré ${filtered.length} unidades para ${session.companyName || result.cliente || "este cliente"}: ${filtered.map((u) => u.patente || u.unidad).join(", ")}.`;

  return NextResponse.json(
    {
      ...result,
      unidades: filtered,
      companyName: session.companyName ?? result.cliente ?? "",
      contactName: session.contactName ?? "",
      unidadesCount: filtered.length,
      summaryText,
    },
    { status: result.ok ? 200 : result.status }
  );
}
