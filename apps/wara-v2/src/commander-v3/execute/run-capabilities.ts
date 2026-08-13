import { createHash, randomUUID } from "node:crypto";
import { buildGpsReportForUnit } from "../../pilot/gps-core.js";
import {
  isCertificateWriteEnabled,
  isOdometerWriteEnabled,
  isOdooWriteEnabled,
} from "../../pilot/write-gates.js";
import type { WaraUnidadEstado } from "../../pilot/wara-types.js";
import {
  answerFromPlatformKnowledge,
  platformKindFromTopic,
  platformStaticFallback,
} from "../../pilot/semantic/platform-knowledge-ai.js";
import { categoryLabel, inferTicketCategory } from "../../pilot/ticket-core.js";
import { getCapability } from "../capabilities/catalog.js";
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan, CapabilityRequest } from "../types/turn-plan.js";
import type { UnitRef } from "../types/refs.js";

export type ToolResult = {
  capability: string;
  ok: boolean;
  facts: string[];
  data?: Record<string, unknown>;
  error?: string;
  writeAttempt?: boolean;
  writeExecuted?: boolean;
};

export type ExecuteContext = {
  state: ConversationStateV3;
  plan: TurnPlan;
  env: NodeJS.ProcessEnv;
  fleetUnits: WaraUnidadEstado[];
  resolvedUnit: UnitRef | null;
  resolvedCompanyId: string | null;
  /** Mensaje del turno (para guías platform_* ancladas al manual). */
  message?: string;
};

function hashPayload(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 32);
}

function unitFromRef(
  ref: UnitRef | null,
  fleet: WaraUnidadEstado[],
): WaraUnidadEstado | null {
  if (!ref) return null;
  return fleet.find((u) => u.movil_id === ref.movilId) ?? null;
}

function missingForMeter(state: ConversationStateV3, plan: TurnPlan): string[] {
  const collected = {
    ...(state.activeTask?.collected ?? {}),
    ...(plan.suppliedFields ?? {}),
  };
  const miss: string[] = [];
  if (!state.unit && !plan.unitReference) miss.push("unit");
  if (collected.value == null && (plan.suppliedFields?.value == null)) miss.push("value");
  if (!collected.date && !plan.suppliedFields?.date) miss.push("date");
  if (!collected.time && !plan.suppliedFields?.time) miss.push("time");
  return miss;
}

export async function executeCapabilities(ctx: ExecuteContext): Promise<{
  results: ToolResult[];
  state: ConversationStateV3;
  facts: string[];
}> {
  const results: ToolResult[] = [];
  const facts: string[] = [...(ctx.plan.responseGoal.facts ?? [])];
  let state = ctx.state;

  const caps =
    ctx.plan.requestedCapabilities.length > 0
      ? ctx.plan.requestedCapabilities
      : inferDefaultCapabilities(ctx.plan, state);

  for (const req of caps) {
    const r = await runOne(req, { ...ctx, state });
    results.push(r);
    facts.push(...r.facts);
    if (r.data?.statePatch && typeof r.data.statePatch === "object") {
      state = { ...state, ...(r.data.statePatch as Partial<ConversationStateV3>) };
    }
  }

  return { results, state, facts };
}

function inferDefaultCapabilities(
  plan: TurnPlan,
  state: ConversationStateV3,
): CapabilityRequest[] {
  switch (plan.conversationalAct) {
    case "greet":
      return [];
    case "confirm_write":
      if (!state.pendingWrite) return [];
      if (state.pendingWrite.task.includes("certificate")) {
        return [{ name: "certificate.issue", params: {} }];
      }
      if (state.pendingWrite.task.includes("hourmeter")) {
        return [{ name: "hourmeter.update", params: {} }];
      }
      if (state.pendingWrite.task.includes("odometer")) {
        return [{ name: "odometer.update", params: {} }];
      }
      if (state.pendingWrite.task.includes("maintenance")) {
        return [{ name: "maintenance.create", params: {} }];
      }
      if (state.pendingWrite.task.includes("handoff")) {
        return [{ name: "handoff.create", params: {} }];
      }
      return [];
    case "cancel_task":
      return [];
    default:
      break;
  }
  if (plan.task === "gps" || plan.conversationalAct === "answer_lateral") {
    const lateralGps =
      plan.lateralQuestion?.topic === "gps" || plan.task === "gps";
    if (lateralGps) {
      return [{ name: "gps.get_status", params: {} }];
    }
  }
  if (plan.taskAction === "start" || plan.conversationalAct === "start_task") {
    if (plan.task === "certificate") return [{ name: "certificate.prepare", params: {} }];
    if (plan.task === "odometer") return [{ name: "odometer.prepare", params: {} }];
    if (plan.task === "hourmeter") return [{ name: "hourmeter.prepare", params: {} }];
    if (plan.task === "maintenance") return [{ name: "maintenance.prepare", params: {} }];
    if (plan.task === "human_handoff") return [{ name: "handoff.prepare", params: {} }];
    if (plan.task === "gps") return [{ name: "gps.get_status", params: {} }];
    if (plan.task === "unit_query") return [{ name: "unit.search", params: {} }];
  }
  return [];
}

async function runOne(req: CapabilityRequest, ctx: ExecuteContext): Promise<ToolResult> {
  const def = getCapability(req.name);
  if (!def) {
    return { capability: req.name, ok: false, facts: [], error: "unknown_capability" };
  }

  switch (req.name) {
    case "company.get_active": {
      if (!ctx.state.company) {
        return { capability: req.name, ok: false, facts: [], error: "no_company" };
      }
      return {
        capability: req.name,
        ok: true,
        facts: [`Empresa activa: ${ctx.state.company.name}.`],
      };
    }
    case "company.list": {
      const items = ctx.state.availableCompanies.map((c, i) => ({
        index: i + 1,
        label: c.name,
        companyId: c.id,
      }));
      const listing = {
        kind: "companies" as const,
        page: 1,
        pageSize: 20,
        totalCount: items.length,
        items,
        fetchedAt: new Date().toISOString(),
      };
      const lines = items.map((i) => `${i.index}. ${i.label}`).join("\n");
      return {
        capability: req.name,
        ok: true,
        facts: [`Empresas disponibles:\n${lines}`],
        data: {
          statePatch: {
            lastListing: listing,
            lastQuestion: {
              id: randomUUID(),
              purpose: "select_company",
              expected: "company" as const,
            },
            pendingEntity: {
              type: "company" as const,
              purpose: "select",
              candidates: ctx.state.availableCompanies,
            },
          },
        },
      };
    }
    case "company.select": {
      const id = String(req.params?.companyId ?? ctx.resolvedCompanyId ?? "");
      const company =
        ctx.state.availableCompanies.find((c) => c.id === id) ??
        (ctx.resolvedCompanyId
          ? ctx.state.availableCompanies.find((c) => c.id === ctx.resolvedCompanyId)
          : null);
      if (!company) {
        return { capability: req.name, ok: false, facts: [], error: "not_found" };
      }
      return {
        capability: req.name,
        ok: true,
        facts: [`Seguimos con ${company.name}.`],
        data: {
          statePatch: {
            company,
            pendingEntity: null,
            lastQuestion: null,
            lastListing: null,
          },
        },
      };
    }
    case "unit.search": {
      const pageSize = 8;
      const items = ctx.state.fleetCache.slice(0, pageSize).map((u, i) => ({
        index: i + 1,
        label: u.label,
        movilId: u.movilId,
      }));
      const listing = {
        kind: "fleet" as const,
        page: 1,
        pageSize,
        totalCount: ctx.state.fleetCache.length,
        items,
        fetchedAt: new Date().toISOString(),
      };
      const header = `Unidades en ${ctx.state.company?.name ?? "tu empresa"} (página 1/${Math.max(1, Math.ceil(listing.totalCount / pageSize))}, ${listing.totalCount} en total):`;
      const body = items.map((i) => `${i.index}. ${i.label}`).join("\n");
      return {
        capability: req.name,
        ok: true,
        facts: [`${header}\n\n${body}\n\nDecime el número o la patente.`],
        data: {
          statePatch: {
            lastListing: listing,
            lastQuestion: {
              id: randomUUID(),
              purpose: "select_unit",
              expected: "unit" as const,
            },
            pendingEntity: ctx.state.pendingEntity ?? {
              type: "unit" as const,
              purpose: ctx.state.activeTask?.type ?? "unit_query",
            },
          },
        },
      };
    }
    case "unit.select": {
      const unit = ctx.resolvedUnit;
      if (!unit) {
        return { capability: req.name, ok: false, facts: [], error: "not_found" };
      }
      const previousUnit = ctx.state.unit;
      return {
        capability: req.name,
        ok: true,
        facts: [`Unidad: ${unit.label}.`],
        data: {
          statePatch: {
            previousUnit: previousUnit ?? ctx.state.previousUnit,
            unit,
            pendingEntity: null,
            lastQuestion: null,
          },
        },
      };
    }
    case "unit.get_active": {
      if (!ctx.state.unit) {
        return { capability: req.name, ok: false, facts: [], error: "no_unit" };
      }
      return {
        capability: req.name,
        ok: true,
        facts: [`Unidad activa: ${ctx.state.unit.label}.`],
      };
    }
    case "unit.get_previous": {
      if (!ctx.state.previousUnit) {
        return { capability: req.name, ok: false, facts: [], error: "no_previous" };
      }
      return {
        capability: req.name,
        ok: true,
        facts: [`Unidad anterior: ${ctx.state.previousUnit.label}.`],
      };
    }
    case "gps.get_status": {
      const unit =
        unitFromRef(ctx.resolvedUnit ?? ctx.state.unit, ctx.fleetUnits) ??
        ctx.fleetUnits.find((u) => u.movil_id === ctx.state.unit?.movilId);
      if (!unit) {
        return { capability: req.name, ok: false, facts: [], error: "no_unit" };
      }
      const report = buildGpsReportForUnit(unit);
      return { capability: req.name, ok: true, facts: [report] };
    }
    case "certificate.prepare": {
      const unit = ctx.resolvedUnit ?? ctx.state.unit;
      if (!unit) {
        return {
          capability: req.name,
          ok: false,
          facts: [],
          error: "no_unit",
          data: {
            statePatch: {
              activeTask: {
                type: "certificate" as const,
                status: "collecting" as const,
                collected: {},
                missing: ["unit"],
              },
              pendingEntity: { type: "unit" as const, purpose: "certificate" },
              lastQuestion: {
                id: randomUUID(),
                purpose: "unit_for_certificate",
                expected: "unit" as const,
              },
            },
          },
        };
      }
      const payload = {
        task: "certificate",
        movilId: unit.movilId,
        plate: unit.plate,
        company: ctx.state.company?.name ?? null,
      };
      const operationId = `cert_${randomUUID().slice(0, 12)}`;
      const payloadHash = hashPayload(payload);
      const version = 1;
      const q = `¿Confirmás el certificado de cobertura para ${unit.label}? Respondé CONFIRMO para emitir (simulado).`;
      return {
        capability: req.name,
        ok: true,
        facts: [q],
        writeAttempt: false,
        writeExecuted: false,
        data: {
          statePatch: {
            unit,
            activeTask: {
              type: "certificate" as const,
              status: "awaiting_confirmation" as const,
              collected: { unit },
              missing: [],
            },
            pendingEntity: null,
            pendingWrite: {
              operationId,
              version,
              payloadHash,
              task: "certificate",
              summary: payload,
            },
            lastQuestion: {
              id: randomUUID(),
              purpose: "confirm_certificate",
              expected: "confirmation" as const,
            },
          },
        },
      };
    }
    case "certificate.issue":
    case "odometer.update":
    case "hourmeter.update":
    case "maintenance.create":
    case "handoff.create": {
      return commitWrite(req.name, ctx);
    }
    case "odometer.prepare":
    case "hourmeter.prepare": {
      const meter = req.name.startsWith("hour") ? "hourmeter" : "odometer";
      const unit = ctx.resolvedUnit ?? ctx.state.unit;
      const miss = missingForMeter(ctx.state, ctx.plan);
      if (!unit || miss.includes("unit")) {
        return {
          capability: req.name,
          ok: false,
          facts: [],
          error: "no_unit",
          data: {
            statePatch: {
              activeTask: {
                type: meter as "odometer" | "hourmeter",
                status: "collecting" as const,
                collected: { ...(ctx.plan.suppliedFields ?? {}) },
                missing: ["unit"],
              },
              pendingEntity: { type: "unit" as const, purpose: meter },
              lastQuestion: {
                id: randomUUID(),
                purpose: "unit_for_meter",
                expected: "unit" as const,
              },
            },
          },
        };
      }
      const collected = {
        ...(ctx.state.activeTask?.collected ?? {}),
        ...(ctx.plan.suppliedFields ?? {}),
      };
      const still = [];
      if (collected.value == null) still.push("value");
      if (!collected.date) still.push("date");
      if (!collected.time) still.push("time");
      if (still.length) {
        const expected =
          still[0] === "value" ? "value" : still[0] === "date" ? "date" : "time";
        const ask =
          expected === "value"
            ? `Pasame el valor del ${meter === "hourmeter" ? "horómetro (hs)" : "odómetro (km)"}.`
            : expected === "date"
              ? "¿Qué fecha de lectura? (ej. hoy, 11/08/26)"
              : "¿A qué hora? (ej. 14:30)";
        return {
          capability: req.name,
          ok: true,
          facts: [ask],
          data: {
            statePatch: {
              unit,
              activeTask: {
                type: meter as "odometer" | "hourmeter",
                status: "collecting" as const,
                collected,
                missing: still,
              },
              pendingEntity: null,
              lastQuestion: {
                id: randomUUID(),
                purpose: `meter_${expected}`,
                expected: expected as "value" | "date" | "time",
              },
            },
          },
        };
      }
      const payload = {
        task: meter,
        movilId: unit.movilId,
        value: collected.value,
        date: collected.date,
        time: collected.time,
      };
      const operationId = `${meter}_${randomUUID().slice(0, 12)}`;
      const payloadHash = hashPayload(payload);
      const q = `¿Confirmás ${meter === "hourmeter" ? "horómetro" : "odómetro"} ${collected.value} el ${collected.date} ${collected.time} en ${unit.label}? Respondé CONFIRMO.`;
      return {
        capability: req.name,
        ok: true,
        facts: [q],
        data: {
          statePatch: {
            unit,
            activeTask: {
              type: meter as "odometer" | "hourmeter",
              status: "awaiting_confirmation" as const,
              collected,
              missing: [],
            },
            pendingWrite: {
              operationId,
              version: 1,
              payloadHash,
              task: meter,
              summary: payload,
            },
            lastQuestion: {
              id: randomUUID(),
              purpose: `confirm_${meter}`,
              expected: "confirmation" as const,
            },
          },
        },
      };
    }
    case "maintenance.prepare": {
      const unit = ctx.resolvedUnit ?? ctx.state.unit;
      const detail =
        ctx.plan.suppliedFields?.detail ??
        (ctx.state.activeTask?.collected?.detail as string | undefined);
      if (!unit) {
        return {
          capability: req.name,
          ok: false,
          facts: [],
          error: "no_unit",
          data: {
            statePatch: {
              activeTask: {
                type: "maintenance" as const,
                status: "collecting" as const,
                collected: { detail },
                missing: ["unit"],
              },
              pendingEntity: { type: "unit" as const, purpose: "maintenance" },
              lastQuestion: {
                id: randomUUID(),
                purpose: "unit_for_maintenance",
                expected: "unit" as const,
              },
            },
          },
        };
      }
      if (!detail) {
        return {
          capability: req.name,
          ok: true,
          facts: ["Contame el detalle del mantenimiento que necesitás."],
          data: {
            statePatch: {
              unit,
              activeTask: {
                type: "maintenance" as const,
                status: "collecting" as const,
                collected: {},
                missing: ["detail"],
              },
              lastQuestion: {
                id: randomUUID(),
                purpose: "maintenance_detail",
                expected: "free_text" as const,
              },
            },
          },
        };
      }
      const payload = { task: "maintenance", movilId: unit.movilId, detail };
      const operationId = `maint_${randomUUID().slice(0, 12)}`;
      const payloadHash = hashPayload(payload);
      return {
        capability: req.name,
        ok: true,
        facts: [
          `¿Confirmás el pedido de mantenimiento para ${unit.label}? Detalle: ${detail}. Respondé CONFIRMO.`,
        ],
        data: {
          statePatch: {
            unit,
            activeTask: {
              type: "maintenance" as const,
              status: "awaiting_confirmation" as const,
              collected: { detail },
              missing: [],
            },
            pendingWrite: {
              operationId,
              version: 1,
              payloadHash,
              task: "maintenance",
              summary: payload,
            },
            lastQuestion: {
              id: randomUUID(),
              purpose: "confirm_maintenance",
              expected: "confirmation" as const,
            },
          },
        },
      };
    }
    case "handoff.prepare": {
      const detail =
        ctx.plan.suppliedFields?.detail ??
        (ctx.state.activeTask?.collected?.detail as string | undefined);
      if (!detail) {
        return {
          capability: req.name,
          ok: true,
          facts: ["Contame el motivo para derivarte con un asesor."],
          data: {
            statePatch: {
              activeTask: {
                type: "human_handoff" as const,
                status: "collecting" as const,
                collected: {},
                missing: ["detail"],
              },
              lastQuestion: {
                id: randomUUID(),
                purpose: "handoff_detail",
                expected: "free_text" as const,
              },
            },
          },
        };
      }
      const category = inferTicketCategory(detail);
      const payload = {
        task: "handoff",
        category,
        categoryLabel: categoryLabel(category),
        detail,
        unit: ctx.state.unit?.label ?? null,
        company: ctx.state.company?.name ?? null,
      };
      const operationId = `ticket_${randomUUID().slice(0, 12)}`;
      const payloadHash = hashPayload(payload);
      return {
        capability: req.name,
        ok: true,
        facts: [
          `¿Confirmás generar el ticket (${categoryLabel(category)})? Motivo: ${detail}. Respondé CONFIRMO (no alcanza con gracias/chau).`,
        ],
        data: {
          statePatch: {
            activeTask: {
              type: "human_handoff" as const,
              status: "awaiting_confirmation" as const,
              collected: { detail, category },
              missing: [],
            },
            pendingWrite: {
              operationId,
              version: 1,
              payloadHash,
              task: "handoff",
              summary: payload,
            },
            lastQuestion: {
              id: randomUUID(),
              purpose: "confirm_handoff",
              expected: "confirmation" as const,
            },
          },
        },
      };
    }
    case "domain.answer": {
      const topic = String(req.params?.topic ?? ctx.plan.lateralQuestion?.topic ?? "");
      const platformKind = platformKindFromTopic(topic);
      if (platformKind) {
        const userQ =
          ctx.message?.trim() ||
          [...ctx.state.recentTurns].reverse().find((t) => t.role === "user")?.text ||
          `Guía ${platformKind}`;
        const ai = await answerFromPlatformKnowledge({
          kind: platformKind,
          question: userQ,
          recentTurns: ctx.state.recentTurns,
          env: ctx.env,
        });
        const answer = ai ?? platformStaticFallback(platformKind, userQ);
        return { capability: req.name, ok: true, facts: [answer] };
      }
      const answer = domainFact(topic);
      return { capability: req.name, ok: true, facts: [answer] };
    }
    default:
      return { capability: req.name, ok: false, facts: [], error: "unhandled" };
  }
}

function commitWrite(name: string, ctx: ExecuteContext): ToolResult {
  const pw = ctx.state.pendingWrite;
  if (!pw) {
    return { capability: name, ok: false, facts: [], error: "no_pending", writeAttempt: true };
  }
  if (ctx.plan.conversationalAct !== "confirm_write" && ctx.plan.taskAction !== "confirm") {
    return {
      capability: name,
      ok: false,
      facts: [],
      error: "not_confirmed",
      writeAttempt: true,
      writeExecuted: false,
    };
  }
  // Gates: never authorize real writes in lab/shadow defaults
  const gateOk =
    name.startsWith("certificate")
      ? isCertificateWriteEnabled(ctx.env)
      : name.startsWith("odometer") || name.startsWith("hourmeter")
        ? isOdometerWriteEnabled(ctx.env)
        : name.startsWith("handoff") || name.startsWith("maintenance")
          ? isOdooWriteEnabled(ctx.env)
          : false;

  // Paridad V2: si la escritura de certificado está habilitada pero el gate
  // indica fallo operativo (env WARA_V2_CERT_FORCE_FAIL), escalar a handoff.
  if (
    name.startsWith("certificate") &&
    gateOk &&
    ctx.env.WARA_V2_CERT_FORCE_FAIL === "true"
  ) {
    const detail =
      `No se pudo generar el certificado` +
      (ctx.state.unit?.label ? ` para ${ctx.state.unit.label}` : "");
    const category = "certificate_escalation" as const;
    const payload = {
      task: "handoff",
      category,
      categoryLabel: categoryLabel(category),
      detail,
      unit: ctx.state.unit?.label ?? null,
      company: ctx.state.company?.name ?? null,
    };
    const operationId = `ticket_${randomUUID().slice(0, 12)}`;
    return {
      capability: name,
      ok: true,
      facts: [
        `${detail}. Te derivo con un asesor.`,
        `¿Confirmás el ticket (${categoryLabel(category)})? Motivo: ${detail}. Respondé CONFIRMO.`,
      ],
      writeAttempt: true,
      writeExecuted: false,
      data: {
        statePatch: {
          pendingWrite: {
            operationId,
            version: 1,
            payloadHash: hashPayload(payload),
            task: "handoff",
            summary: payload,
          },
          activeTask: {
            type: "human_handoff" as const,
            status: "awaiting_confirmation" as const,
            collected: { detail, category },
            missing: [],
          },
          lastQuestion: {
            id: randomUUID(),
            purpose: "confirm_handoff",
            expected: "confirmation" as const,
          },
        },
      },
    };
  }

  const simulated = !gateOk;
  const msg = simulated
    ? `Registro simulado OK (${pw.task}). Sin escritura real. operationId=${pw.operationId}.`
    : `Escritura ejecutada (${pw.task}) operationId=${pw.operationId}.`;

  return {
    capability: name,
    ok: true,
    facts: [msg],
    writeAttempt: true,
    writeExecuted: !simulated,
    data: {
      statePatch: {
        pendingWrite: null,
        lastQuestion: null,
        activeTask: ctx.state.activeTask
          ? { ...ctx.state.activeTask, status: "completed" as const }
          : null,
      },
    },
  };
}

function domainFact(topic: string): string {
  const t = topic.toLowerCase();
  if (t.includes("platform_unidades") || t.includes("chevron") || t.includes("atajo")) {
    return platformStaticFallback("unidades", topic);
  }
  if (t.includes("platform_opciones") || t.includes("agenda") || t.includes("notific")) {
    return platformStaticFallback("opciones", topic);
  }
  if (t.includes("odom")) {
    return "El odómetro mide kilómetros recorridos. Sirve para control de uso y mantenimiento.";
  }
  if (t.includes("horo")) {
    return "El horómetro mide horas de motor. Es distinto del odómetro (km).";
  }
  if (t.includes("cert")) {
    return "El certificado de cobertura acredita la unidad ante controles. Se emite sobre una patente concreta.";
  }
  if (t.includes("gps") || t.includes("reporte")) {
    return "El último reporte GPS indica cuándo la unidad comunicó posición/ignición a WARA.";
  }
  if (t.includes("wara") || t.includes("capacid")) {
    return (
      "Puedo ayudarte con GPS, odómetro/horómetro, certificado, mantenimiento, " +
      "derivación a asesor y guías del panel (Unidades / Opciones)."
    );
  }
  return "Si me contás el tema (GPS, certificado, odómetro/horómetro, mantenimiento, panel), te respondo con precisión.";
}
