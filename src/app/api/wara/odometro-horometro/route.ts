import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  isCustomerContextAuthConfigured,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";
import { registrarCambioOdometroHorometro, resolveWaraSessionByPhone } from "@/lib/waraApi";
import { detectPlate, normalizePlate } from "@/lib/wara";

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
    rawText: z.string().optional(),
    confirm: z.string().optional(),
    confirmation: z.string().optional(),
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

function fechaUtc(value: string | undefined): string {
  if (!value?.trim()) return new Date().toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function parseFromText(rawText: string): {
  patente?: string;
  odometro?: number;
  horometro?: number;
} {
  const text = rawText || "";
  const patente = detectPlate(text) ?? undefined;
  const kmMatch =
    text.match(/(?:od[oó]metro|kilometraje|km|kil[oó]metros?)\D{0,20}(\d[\d.,]*)/i) ||
    text.match(/(\d[\d.,]*)\s*(?:km|kil[oó]metros?)/i);
  const horoMatch =
    text.match(/(?:hor[oó]metro|horas?)\D{0,20}(\d[\d.,]*)/i) ||
    text.match(/(\d[\d.,]*)\s*(?:hs|h|horas?)/i);
  return {
    patente,
    odometro: parseNumber(kmMatch?.[1]),
    horometro: parseNumber(horoMatch?.[1]),
  };
}

function isConfirmed(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  return /^(si|sí|s|confirmo|confirmar|ok|dale|correcto)$/i.test(value.trim());
}

function formatSuccessMessage(result: Awaited<ReturnType<typeof registrarCambioOdometroHorometro>>, patente: string): string {
  if (!result.ok) return result.error || "No pude registrar el cambio en Wara.";
  const parts = [`Listo, registré el cambio para la unidad ${patente}.`];
  if (result.odometro?.valor_nuevo_km != null) {
    parts.push(`Odómetro nuevo: ${result.odometro.valor_nuevo_km} km.`);
  }
  if (result.horometro?.valor_nuevo_horas != null) {
    parts.push(`Horómetro nuevo: ${result.horometro.valor_nuevo_horas} h.`);
  }
  return parts.join(" ");
}

export async function POST(req: NextRequest) {
  if (!isCustomerContextAuthConfigured()) {
    return NextResponse.json(
      { ok: false, error: "BUILDERBOT_CONTEXT_API_KEY/PULZE_API_KEY no configurado", message: "No pude autenticar la solicitud interna." },
      { status: 503 }
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Body inválido", message: "Faltan datos para registrar el cambio.", details: parsed.error.flatten() }, { status: 400 });
  }

  if (!validateContextSecret(keyFromRequest(req, parsed.data))) {
    return NextResponse.json({ ok: false, error: "API key inválida o faltante", message: "No pude autenticar la solicitud interna." }, { status: 401 });
  }

  const fromText = parseFromText(parsed.data.rawText ?? "");
  const patente = normalizePlate(parsed.data.patente ?? parsed.data.plate ?? fromText.patente ?? "");
  const fecha = fechaUtc(parsed.data.fecha ?? parsed.data.date);
  const odometro = parsed.data.odometro ?? parsed.data.odometer ?? fromText.odometro;
  const horometro = parsed.data.horometro ?? parsed.data.hourmeter ?? fromText.horometro;
  const confirmation = parsed.data.confirm ?? parsed.data.confirmation;

  if (!patente) {
    return NextResponse.json({ ok: false, error: "Patente inválida", message: "Necesito una patente válida para registrar el cambio." }, { status: 400 });
  }
  if (!fecha) {
    return NextResponse.json({ ok: false, error: "Fecha inválida", message: "La fecha indicada no es válida." }, { status: 400 });
  }
  if (!(typeof odometro === "number" && Number.isFinite(odometro)) && !(typeof horometro === "number" && Number.isFinite(horometro))) {
    return NextResponse.json({ ok: false, error: "Falta odómetro u horómetro", message: "Necesito el valor de odómetro y/o horómetro para registrar el cambio." }, { status: 400 });
  }
  if (!isConfirmed(confirmation)) {
    return NextResponse.json({
      ok: false,
      confirmationRequired: true,
      error: "Falta confirmación",
      message: `Antes de registrar en Wara, confirmá si querés aplicar este cambio: patente ${patente}${typeof odometro === "number" ? `, odómetro ${odometro} km` : ""}${typeof horometro === "number" ? `, horómetro ${horometro} h` : ""}. Respondé CONFIRMO para continuar.`,
      patente,
      odometro,
      horometro,
      fecha,
    }, { status: 409 });
  }

  const rawPhone = (parsed.data.phone ?? parsed.data.from ?? "").trim();
  const session = await resolveWaraSessionByPhone(prisma, rawPhone);
  if (!session.ok || !session.sessionToken) {
    return NextResponse.json(
      {
        ok: false,
        error: session.error,
        message: session.requiresCompanySelection
          ? "Antes de registrar el cambio necesito que elijas la empresa asociada a este número."
          : "No pude validar la sesión con Wara para registrar el cambio. Te derivo con un agente.",
        requiresCompanySelection: session.requiresCompanySelection ?? false,
        testBlocked: session.testBlocked ?? false,
      },
      { status: session.status }
    );
  }

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
      message: formatSuccessMessage(result, patente),
    },
    { status: result.ok ? 200 : result.status }
  );
}
