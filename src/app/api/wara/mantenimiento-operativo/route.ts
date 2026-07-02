import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  isCustomerContextAuthConfigured,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";
import { generateTicketCode } from "@/lib/tickets";
import { detectPlate, formatPlateWithSpaces, hasPendingMaintenancePlateRequest, normalizePlate } from "@/lib/wara";
import { resolvePlateWithWaraFleet } from "@/lib/waraUnitIntent";
import {
  looksLikeChangeCompanyRequest,
  looksLikeMaintenanceInfoGuideInThread,
  looksLikeOpcionesInfoRequest,
  looksLikeUnidadesInfoRequest,
  looksLikePlatformInfoGuideInThread,
  looksLikeOperationalMaintenanceIntent,
  looksLikeShortAffirmative,
  looksLikeTurnoOrAgendaQuestion,
  resetCustomerCompanyMenu,
  resolveCustomerByWaraPhone,
  resolveWaraSessionByPhone,
  shouldSkipStrayMaintenanceRequest,
  validatePlateInFleetForPhone,
} from "@/lib/waraApi";
import { recentLastInboundTextForPhone } from "@/lib/conversationThread";
import { OPEN_TICKET_THREAD_STATUSES } from "@/lib/ticketThreading";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";
import { createHelpdeskTicket, getOdooConfig } from "@/lib/odooApi";

const bodySchema = z
  .object({
    phone: z.string().min(8).optional(),
    from: z.string().min(8).optional(),
    servicio: z.string().optional(),
    service: z.string().optional(),
    detalle: z.string().optional(),
    detail: z.string().optional(),
    patente: z.string().optional(),
    plate: z.string().optional(),
    rawText: z.string().optional(),
    confirm: z.string().optional(),
    confirmation: z.string().optional(),
    prioridad: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
    api_key: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
    key: z.string().min(1).optional(),
    token: z.string().min(1).optional(),
  })
  .refine((d) => (d.phone ?? d.from ?? "").trim().length >= 8, {
    message: "Indica phone o from con el numero.",
  });

type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

const BB_STATUS = 200;
const OPEN_THREAD_STATUSES: Array<"OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER"> = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
];

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

function inferService(raw: string): string {
  const text = raw.toLowerCase();
  if (/(correctiv|aver[ií]a|falla|rotura)/.test(text)) return "Correctivo";
  if (/(rfid|neum[aá]tic|cubierta)/.test(text)) return "Neumaticos RFID";
  if (/(plan|preventiv)/.test(text)) return "Plan de mantenimiento";
  if (/(tarea|orden de trabajo)/.test(text)) return "Tarea de mantenimiento";
  return "Gestion de mantenimiento";
}

function inferPriority(raw: string): Priority {
  const text = raw.toLowerCase();
  if (/(urgente|cr[ií]tic|parad|detenid)/.test(text)) return "URGENT";
  if (/(alta|correctiv|falla|no funciona|error)/.test(text)) return "HIGH";
  if (/(baja|leve)/.test(text)) return "LOW";
  return "NORMAL";
}

function isMaintenanceHowToRequest(raw: string): boolean {
  if (looksLikeOperationalMaintenanceIntent(raw)) return false;
  if (looksLikeTurnoOrAgendaQuestion(raw)) return false;
  if (looksLikeOpcionesInfoRequest(raw)) return false;
  if (looksLikeUnidadesInfoRequest(raw)) return false;
  const text = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const maintenanceDomain =
    /\b(mantenimiento|preventiv|correctiv|tarea|plan|combustible|rendimiento|consumo|neumatic|rfid|cubierta|averia|falla|orden de trabajo)\b/;
  const howToCue =
    /(como|enseña|ensena|explica|ayuda|paso a paso|configur|crear|cargar|usar|utilizar|modulo)/;
  return maintenanceDomain.test(text) && howToCue.test(text);
}

function hasPendingMantenimientoConfirmation(threadText: string): boolean {
  const lines = threadText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const tail = lines.slice(-6).join("\n").toLowerCase();
  if (/perfecto|deje registrada|orientacion de uso del modulo/.test(tail)) return false;
  return /voy a registrar:/.test(tail) && /responde\s+confirmo/.test(tail);
}

function maintenanceHowToMessage(raw: string): string {
  const text = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (/combustible|rendimiento/.test(text)) {
    return [
      "Te explico cómo configurar una unidad para seguimiento de consumo con rendimiento teórico en el módulo de mantenimiento:",
      "",
      "1. Ingresá al módulo de Mantenimiento.",
      "2. Buscá la unidad que querés configurar.",
      "3. Entrá a la configuración de consumo/rendimiento de la unidad.",
      "4. Cargá el rendimiento teórico esperado según el tipo de unidad y combustible.",
      "5. Guardá los cambios y verificá que la unidad quede asociada al plan o control correspondiente.",
      "",
      "Con eso el módulo puede usar ese valor como referencia para el control preventivo. Estos pasos son una guía inicial; si Emi valida algún nombre exacto de menú, lo ajusto con ese texto.",
    ].join("\n");
  }

  if (/correctiv/.test(text)) {
    return [
      "Para una tarea correctiva en el módulo de mantenimiento:",
      "",
      "1. Ingresá al módulo de Mantenimiento.",
      "2. Creá una nueva tarea u orden correctiva.",
      "3. Seleccioná la unidad afectada.",
      "4. Describí la falla o trabajo a realizar.",
      "5. Asigná prioridad/responsable si el módulo lo permite.",
      "6. Guardá y hacé seguimiento del estado hasta el cierre.",
      "",
      "La idea es registrar la acción correctiva para seguimiento interno, no manipular el equipo GPS desde el cliente.",
    ].join("\n");
  }

  if (/preventiv|plan/.test(text)) {
    return [
      "Para una tarea preventiva en el módulo de mantenimiento:",
      "",
      "1. Ingresá al módulo de Mantenimiento.",
      "2. Creá o seleccioná un plan preventivo.",
      "3. Asociá las unidades que correspondan.",
      "4. Definí la frecuencia o condición de disparo (por ejemplo, fecha, kilometraje u horas, según disponibilidad del módulo).",
      "5. Guardá el plan y verificá que quede activo.",
      "",
      "Esto permite organizar mantenimientos programados sin abrir un reclamo técnico.",
    ].join("\n");
  }

  return [
    "El módulo de mantenimiento sirve para gestionar tareas preventivas y correctivas sobre las unidades.",
    "",
    "Como guía general:",
    "1. Entrá al módulo de Mantenimiento.",
    "2. Elegí si vas a trabajar con una tarea preventiva, correctiva o un plan.",
    "3. Seleccioná la unidad o grupo de unidades.",
    "4. Cargá la descripción, frecuencia o condición de control según corresponda.",
    "5. Guardá y hacé seguimiento desde el estado de la tarea.",
    "",
    "No genero un ticket por esta consulta porque es una orientación de uso del módulo. Si necesitás una guía más puntual, decime qué querés configurar.",
  ].join("\n");
}

/**
 * Confirmación tolerante: acepta CONFIRMO en cualquier capitalización, con acentos,
 * espacios o puntuación de más, y también un "sí" claro (sí, dale, ok, listo, etc.).
 * No exige mayúsculas ni la palabra exacta.
 */
function isConfirmed(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  const t = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
  if (!t) return false;
  if (t.startsWith("conf")) return true;
  const accepted = new Set([
    "confirmo",
    "confirmar",
    "confirmado",
    "confirma",
    "siconfirmo",
    "si",
    "sii",
    "sip",
    "dale",
    "dalesi",
    "sidale",
    "ok",
    "oka",
    "okey",
    "okay",
    "listo",
    "correcto",
    "deacuerdo",
    "registra",
    "registralo",
    "hacelo",
    "adelante",
    "avanza",
    "vamos",
    "perfecto",
  ]);
  return accepted.has(t);
}

/**
 * Reconstruye el texto de la conversación reciente desde la base.
 * BuilderBot manda {history} multilínea que rompe el JSON del body; en vez de eso,
 * leemos lo persistido para reconstruir patente / tipo / prioridad / detalle del
 * resumen "Voy a registrar:" en el paso de CONFIRMO.
 */
async function recentThreadText(rawPhone: string): Promise<string> {
  try {
    const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
    if (!customer) return "";
    const ticket = await prisma.ticket.findFirst({
      where: { customerId: customer.id },
      orderBy: { lastMessageAt: "desc" },
    });
    if (!ticket) return "";
    const msgs = await prisma.ticketMessage.findMany({
      where: { ticketId: ticket.id },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: { text: true },
    });
    return msgs
      .reverse()
      .map((m) => m.text)
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

/** Extrae los datos del resumen "Voy a registrar:" (Patente / Tipo / Prioridad / Detalle). */
function parseMantenimientoSummary(text: string): {
  patente?: string;
  servicio?: string;
  prioridad?: Priority;
  detalle?: string;
} {
  const out: { patente?: string; servicio?: string; prioridad?: Priority; detalle?: string } = {};
  const patenteM = text.match(/Patente:\s*([A-Za-z0-9 ]{5,12})/);
  if (patenteM) out.patente = patenteM[1].trim();
  const tipoM = text.match(/Tipo:\s*(.+)/);
  if (tipoM) out.servicio = tipoM[1].trim();
  const detalleM = text.match(/Detalle:\s*(.+)/);
  if (detalleM) out.detalle = detalleM[1].trim();
  const prioM = text.match(/Prioridad:\s*(\w+)/i);
  if (prioM) {
    const p = prioM[1].toLowerCase();
    if (/urg/.test(p)) out.prioridad = "URGENT";
    else if (/alt/.test(p)) out.prioridad = "HIGH";
    else if (/baj/.test(p)) out.prioridad = "LOW";
    else out.prioridad = "NORMAL";
  }
  return out;
}

function priorityLabel(priority: Priority): string {
  if (priority === "URGENT") return "urgente";
  if (priority === "HIGH") return "alta";
  if (priority === "LOW") return "baja";
  return "normal";
}

function inferServiceFromThread(threadText: string): string | undefined {
  const t = threadText.toLowerCase();
  if (/preventiv|plan de mantenimiento/.test(t)) return "Plan de mantenimiento";
  if (/correctiv|aver[ií]a|falla/.test(t)) return "Correctivo";
  if (/rfid|neum[aá]tic|cubierta/.test(t)) return "Neumaticos RFID";
  if (/tarea|orden de trabajo/.test(t)) return "Tarea de mantenimiento";
  return undefined;
}

function isPlateOnlyMessage(text: string, plate: string): boolean {
  const stripped = text
    .replace(new RegExp(plate.replace(/(.)/g, "$1\\s?"), "gi"), " ")
    .replace(/[^a-z0-9áéíóúñ]/gi, " ")
    .trim();
  return stripped.length < 24 && !/\b(confir|si|dale|ok|listo)\b/i.test(stripped);
}

async function appendOutboundBotMessage(rawPhone: string, text: string, payload: Record<string, unknown>) {
  const message = text?.trim();
  if (!message) return;
  const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
  if (!customer) return;
  const openTicket = await prisma.ticket.findFirst({
    where: { customerId: customer.id, status: { in: OPEN_TICKET_THREAD_STATUSES } },
    orderBy: { lastMessageAt: "desc" },
  });
  const targetTicket =
    openTicket ??
    (await prisma.ticket.findFirst({
      where: { customerId: customer.id },
      orderBy: { lastMessageAt: "desc" },
    }));
  if (!targetTicket) return;
  const recent = await prisma.ticketMessage.findFirst({
    where: {
      ticketId: targetTicket.id,
      direction: "OUTBOUND",
      from: "BOT",
      text: message,
      createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
    },
  });
  if (recent) return;
  await prisma.ticketMessage.create({
    data: {
      ticketId: targetTicket.id,
      direction: "OUTBOUND",
      from: "BOT",
      text: message,
      rawPayload: payload as Prisma.InputJsonObject,
    },
  });
  await prisma.ticket.update({
    where: { id: targetTicket.id },
    data: { lastMessageAt: new Date(), status: "WAITING_CUSTOMER" },
  });
}

export async function POST(req: NextRequest) {
  if (!isCustomerContextAuthConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        ok_s: "false",
        message: "No pude autenticar la solicitud interna.",
        error: "BUILDERBOT_CONTEXT_API_KEY/PULZE_API_KEY no configurado",
      },
      { status: BB_STATUS }
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        ok_s: "false",
        message: "Faltan datos para registrar la gestion de mantenimiento.",
        error: "Body invalido",
        details: parsed.error.flatten(),
      },
      { status: BB_STATUS }
    );
  }

  if (!validateContextSecret(keyFromRequest(req, parsed.data))) {
    return NextResponse.json(
      { ok: false, ok_s: "false", message: "No pude autenticar la solicitud interna.", error: "API key invalida o faltante" },
      { status: BB_STATUS }
    );
  }

  const rawPhone = (parsed.data.phone ?? parsed.data.from ?? "").trim();
  const resolution = await resolveCustomerByWaraPhone(prisma, rawPhone);
  if (!resolution.registered || !resolution.customer) {
    const message = "No pude validar este numero en Wara para gestionar mantenimiento.";
    await appendOutboundBotMessage(rawPhone, message, {
      source: "wara_mantenimiento_operativo",
      errorStage: "customer_validation",
      testBlocked: resolution.testBlocked ?? false,
    });
    return NextResponse.json(
      {
        ok: false,
        ok_s: "false",
        message,
        requiresCompanySelection: false,
        requiresCompanySelection_s: "false",
        testBlocked: resolution.testBlocked ?? false,
        testBlocked_s: resolution.testBlocked ? "true" : "false",
      },
      { status: BB_STATUS }
    );
  }

  if (resolution.requiresCompanySelection) {
    const message = "Antes de continuar, necesito que elijas la empresa asociada a este numero.";
    await appendOutboundBotMessage(rawPhone, message, {
      source: "wara_mantenimiento_operativo",
      errorStage: "requires_company_selection",
    });
    return NextResponse.json(
      {
        ok: false,
        ok_s: "false",
        message,
        requiresCompanySelection: true,
        requiresCompanySelection_s: "true",
      },
      { status: BB_STATUS }
    );
  }

  const confirmation = parsed.data.confirm ?? parsed.data.confirmation;
  const threadText = await recentThreadText(rawPhone);
  const lastInbound = await recentLastInboundTextForPhone(rawPhone);
  const pendingMaintConfirm = hasPendingMantenimientoConfirmation(threadText);
  const pendingPlateRequest = hasPendingMaintenancePlateRequest(threadText);
  const summary = parseMantenimientoSummary(pendingMaintConfirm ? threadText : "");

  let text =
    parsed.data.rawText?.trim() ||
    parsed.data.detalle?.trim() ||
    parsed.data.detail?.trim() ||
    parsed.data.servicio?.trim() ||
    parsed.data.service?.trim() ||
    confirmation?.trim() ||
    summary.detalle ||
    summary.servicio ||
    "Solicitud de gestion de mantenimiento";

  if (looksLikeChangeCompanyRequest(text)) {
    const reset = await resetCustomerCompanyMenu(prisma, rawPhone);
    return NextResponse.json(
      {
        ok: true,
        ok_s: "true",
        changeCompany_s: "true",
        message: reset.message,
        requiresCompanySelection: reset.requiresCompanySelection,
        requiresCompanySelection_s: reset.requiresCompanySelection ? "true" : "false",
      },
      { status: BB_STATUS }
    );
  }

  if (
    looksLikeTurnoOrAgendaQuestion(text) ||
    looksLikeOpcionesInfoRequest(text) ||
    looksLikeUnidadesInfoRequest(text) ||
    looksLikeOpcionesInfoRequest(lastInbound) ||
    looksLikeUnidadesInfoRequest(lastInbound) ||
    looksLikePlatformInfoGuideInThread(threadText) ||
    looksLikeMaintenanceInfoGuideInThread(threadText)
  ) {
    return NextResponse.json(
      {
        ok: true,
        ok_s: "true",
        message: "",
        skipResponse_s: "true",
        flowComplete_s: "true",
      },
      { status: BB_STATUS }
    );
  }

  if (
    shouldSkipStrayMaintenanceRequest(text, threadText, {
      pendingPlateRequest,
      pendingMaintConfirm,
      lastInbound,
    })
  ) {
    return NextResponse.json(
      {
        ok: true,
        ok_s: "true",
        message: "",
        skipResponse_s: "true",
        flowComplete_s: "true",
      },
      { status: BB_STATUS }
    );
  }

  const threadService = inferServiceFromThread(threadText);
  const service =
    summary.servicio ||
    threadService ||
    inferService(`${parsed.data.servicio ?? parsed.data.service ?? ""} ${text} ${threadText}`);
  const priority =
    parsed.data.prioridad ??
    parsed.data.priority ??
    summary.prioridad ??
    inferPriority(text);

  if (isMaintenanceHowToRequest(text)) {
    const message = maintenanceHowToMessage(text);
    await appendOutboundBotMessage(rawPhone, message, {
      source: "wara_mantenimiento_operativo",
      stage: "how_to",
      service,
      phone: rawPhone,
    });
    return NextResponse.json(
      {
        ok: true,
        ok_s: "true",
        flowComplete_s: "true",
        informational: true,
        informational_s: "true",
        message,
        service,
      },
      { status: BB_STATUS }
    );
  }

  let plate = normalizePlate(
    parsed.data.patente ??
      parsed.data.plate ??
      detectPlate(text) ??
      (pendingMaintConfirm || pendingPlateRequest
        ? summary.patente ?? detectPlate(threadText)
        : undefined) ??
      undefined
  );

  if (!plate) {
    const fleetPlate = await resolvePlateWithWaraFleet(prisma, rawPhone, text, threadText);
    if (!fleetPlate.ok && fleetPlate.reason === "clarification") {
      await appendOutboundBotMessage(rawPhone, fleetPlate.message, {
        source: "wara_mantenimiento_operativo",
        errorStage: "unit_clarification",
        service,
        priority,
        phone: rawPhone,
      });
      return NextResponse.json(
        {
          ok: true,
          ok_s: "true",
          flowComplete_s: "true",
          needsPlate_s: "true",
          message: fleetPlate.message,
          missing: ["patente"],
          missing_s: "patente",
          service,
          priority,
        },
        { status: BB_STATUS }
      );
    }
    if (fleetPlate.ok) {
      plate = fleetPlate.plate;
    }
  }

  if (plate && pendingPlateRequest && isPlateOnlyMessage(text, plate)) {
    const plateDisplay = formatPlateWithSpaces(plate) ?? plate;
    text =
      threadService === "Plan de mantenimiento"
        ? `Mantenimiento preventivo para ${plateDisplay}`
        : `Mantenimiento para ${plateDisplay}`;
  }
  if (!plate) {
    if (looksLikeShortAffirmative(text)) {
      const message =
        "Contame qué necesitás del mantenimiento: por ejemplo «correctivo para AB123CD», «preventivo» o «configurar plan». Si querés cambiar de empresa, escribí «cambiar empresa».";
      await appendOutboundBotMessage(rawPhone, message, {
        source: "wara_mantenimiento_operativo",
        errorStage: "needs_detail",
        phone: rawPhone,
      });
      return NextResponse.json(
        {
          ok: true,
          ok_s: "true",
          flowComplete_s: "true",
          needsDetail_s: "true",
          message,
          service,
          priority,
        },
        { status: BB_STATUS }
      );
    }
    if (looksLikeOperationalMaintenanceIntent(text)) {
      const preventivo = /preventiv/i.test(text);
      const message = preventivo
        ? "Para programar mantenimiento preventivo necesito la patente de la unidad (por ejemplo AD427MC o ABC123). Si querés, agregá también la prioridad."
        : "Para registrar el mantenimiento necesito la patente de la unidad (formato AA123BB o ABC123) junto con un breve detalle y, si querés, la prioridad.";
      await appendOutboundBotMessage(rawPhone, message, {
        source: "wara_mantenimiento_operativo",
        stage: "needs_plate",
        service,
        priority,
        phone: rawPhone,
      });
      return NextResponse.json(
        {
          ok: true,
          ok_s: "true",
          flowComplete_s: "true",
          needsPlate_s: "true",
          message,
          missing: ["patente"],
          missing_s: "patente",
          service,
          priority,
        },
        { status: BB_STATUS }
      );
    }
    if (
      shouldSkipStrayMaintenanceRequest(text, threadText, {
        pendingPlateRequest,
        pendingMaintConfirm,
        lastInbound,
      })
    ) {
      return NextResponse.json(
        {
          ok: true,
          ok_s: "true",
          message: "",
          skipResponse_s: "true",
          flowComplete_s: "true",
        },
        { status: BB_STATUS }
      );
    }
    const message =
      "No pude reconocer una patente completa. Enviamela con formato AA123BB o ABC123 junto con el detalle y la prioridad.";
    await appendOutboundBotMessage(rawPhone, message, {
      source: "wara_mantenimiento_operativo",
      errorStage: "missing_plate",
      service,
      priority,
      phone: rawPhone,
    });
    return NextResponse.json(
      {
        ok: true,
        ok_s: "true",
        flowComplete_s: "true",
        message,
        missing: ["patente"],
        missing_s: "patente",
        service,
        priority,
      },
      { status: BB_STATUS }
    );
  }
  if (!isConfirmed(confirmation)) {
    const company = resolution.selectedCompanyName || resolution.customer.companyName || "tu empresa";
    const fleetCheck = await validatePlateInFleetForPhone(prisma, rawPhone, plate, company, "maintenance");
    if (!fleetCheck.found && fleetCheck.message && isPlateOnlyMessage(text, plate)) {
      await appendOutboundBotMessage(rawPhone, fleetCheck.message, {
        source: "wara_mantenimiento_operativo",
        stage: "plate_not_in_fleet",
        service,
        priority,
        plate,
        companyName: company,
        phone: rawPhone,
      });
      return NextResponse.json(
        {
          ok: true,
          ok_s: "true",
          flowComplete_s: "true",
          plateNotInFleet_s: "true",
          message: fleetCheck.message,
          plate,
          companyName: company,
          service,
          priority,
        },
        { status: BB_STATUS }
      );
    }

    const message = `Voy a registrar:\nPatente: ${plate}\nTipo: ${service}\nPrioridad: ${priorityLabel(priority)}\nDetalle: ${text}\n\nSi esta correcto, responde CONFIRMO para registrarlo.`;
    await appendOutboundBotMessage(rawPhone, message, {
      source: "wara_mantenimiento_operativo",
      stage: "confirmation_required",
      service,
      priority,
      plate,
      phone: rawPhone,
    });
    return NextResponse.json(
      {
        ok: true,
        ok_s: "true",
        flowComplete_s: "true",
        confirmationRequired: true,
        confirmationRequired_s: "true",
        message,
        service,
        priority,
        plate,
      },
      { status: BB_STATUS }
    );
  }
  const title = `${service}${plate ? ` · ${plate}` : ""}`;

  const currentTicket = await prisma.ticket.findFirst({
    where: {
      customerId: resolution.customer.id,
      status: { in: OPEN_THREAD_STATUSES },
      category: "TECH_SUPPORT",
    },
    orderBy: { lastMessageAt: "desc" },
  });

  const ticket =
    currentTicket ??
    (await prisma.ticket.create({
      data: {
        code: generateTicketCode(),
        customerId: resolution.customer.id,
        contactName:
          resolution.customer.name?.trim() ||
          resolution.selectedCompanyName?.trim() ||
          "Sin nombre",
        title,
        status: "OPEN",
        priority,
        category: "TECH_SUPPORT",
        incidentType: "GENERAL_TECH",
        channel: "WHATSAPP",
      },
    }));

  await prisma.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      direction: "INBOUND",
      from: "CUSTOMER",
      text,
      rawPayload: {
        source: "builderbot_mantenimiento_operativo",
        service,
        companyName: resolution.selectedCompanyName ?? "",
        plate: plate ?? "",
        phone: rawPhone,
      },
    },
  });

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      title,
      priority,
      status: ticket.status === "OPEN" ? "IN_PROGRESS" : ticket.status,
      lastMessageAt: new Date(),
      aiSummary: `${service}${plate ? ` para ${plate}` : ""}. Cliente: ${
        resolution.selectedCompanyName || resolution.customer.name || "sin nombre"
      }.`,
    },
  });

  const company = resolution.selectedCompanyName || resolution.customer.companyName || "tu empresa";
  let odooRef: string | null = null;
  const odooCfg = getOdooConfig();
  if (odooCfg) {
    try {
      const odoo = await createHelpdeskTicket(odooCfg, {
        subject: `${plate} - ${service}`,
        description: [
          `Gestión de mantenimiento solicitada desde Atilio / WhatsApp.`,
          `Empresa Wara: ${company}`,
          `Patente: ${plate}`,
          `Tipo: ${service}`,
          `Prioridad: ${priorityLabel(priority)}`,
          `Detalle: ${text}`,
          `WhatsApp: ${rawPhone}`,
          `Ticket local: ${ticket.code}`,
        ].join("\n"),
        customerName:
          resolution.customer.name?.trim() ||
          resolution.customer.companyName?.trim() ||
          company,
        customerPhone: rawPhone,
        companyName: company,
        priority,
      });
      odooRef = odoo.ref ?? String(odoo.ticketId);
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          aiSummary: `${service}${plate ? ` para ${plate}` : ""}. Cliente: ${company}. Odoo: ${odooRef}.`,
        },
      });
    } catch (error) {
      console.error(
        `[Mantenimiento] No se pudo crear ticket Odoo para ${plate}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const responseMessage = odooRef
    ? `Perfecto, deje registrada tu solicitud de ${service.toLowerCase()} para ${company}, patente ${plate}. Caso Odoo ${odooRef}.`
    : `Perfecto, deje registrada tu solicitud de ${service.toLowerCase()} para ${company}, patente ${plate}. Caso ${ticket.code}.`;

  await prisma.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      direction: "OUTBOUND",
      from: "BOT",
      text: responseMessage,
      rawPayload: {
        source: "wara_mantenimiento_operativo",
        generatedBy: "api_response",
        service,
        plate: plate ?? "",
        odooRef: odooRef ?? "",
      },
    },
  });

  return NextResponse.json(
    {
      ok: true,
      ok_s: "true",
      flowComplete_s: "true",
      ticketCode: ticket.code,
      ticketId: ticket.id,
      odooRef,
      service,
      plate: plate ?? "",
      companyName: company,
      message: responseMessage,
    },
    { status: BB_STATUS }
  );
}
