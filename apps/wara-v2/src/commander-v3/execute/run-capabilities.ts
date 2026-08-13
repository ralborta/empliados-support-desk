import { createHash, randomUUID } from "node:crypto";
import { buildGpsReportForUnit } from "../../pilot/gps-core.js";
import { syncV3PendingWriteToFrontend } from "./frontend-sync.js";
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
import {
  formatAnomalyQuestion,
  isAnomalousReading,
} from "../../pilot/semantic/reading-anomaly.js";
import { getCapability } from "../capabilities/catalog.js";
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan, CapabilityRequest } from "../types/turn-plan.js";
import type { UnitRef } from "../types/refs.js";
import {
  filterFleetCacheByQuery,
  isStructuredFleetQuery,
} from "./fleet-query.js";
import { inferMaintenanceMeta } from "./maintenance-meta.js";
import { extractUnitNameCode } from "../../pilot/unit-fleet.js";

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
  /** Idempotencia / ledger front (Prisma + bridge). */
  messageId?: string;
};

function hashPayload(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 32);
}

/** Fecha interna YYYY-MM-DD → display dd/mm/aa (WhatsApp). */
export function formatDateDdMmYy(isoDate: unknown): string {
  if (typeof isoDate !== "string") return String(isoDate ?? "");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return isoDate;
  return `${m[3]}/${m[2]}/${m[1]!.slice(2)}`;
}

/** Pie de confirmación de escritura (CONFIRMO o CANCELAR). */
function confirmOrCancelHint(): string {
  return "Respondé CONFIRMO o CANCELAR.";
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
  if (collected.value == null && plan.suppliedFields?.value == null) miss.push("value");
  if (!collected.date && !plan.suppliedFields?.date) miss.push("date");
  if (!collected.time && !plan.suppliedFields?.time) miss.push("time");
  return miss;
}

/**
 * El LLM a veces pone el código de unidad (900077) como suppliedFields.value (km).
 * Eso hace saltar el pedido de km y pedir fecha primero — incorrecto.
 */
export function stripMeterValueConfusedWithUnit(input: {
  value: unknown;
  unit: { movilId: number; name: string | null; plate: string | null; label: string };
  message?: string;
  unitReferenceValue?: string | null;
}): number | null {
  if (input.value == null || input.value === "") return null;
  const n = Number(input.value);
  if (!Number.isFinite(n)) return null;

  const candidates = new Set<string>();
  const add = (raw: string | null | undefined) => {
    if (!raw) return;
    const digits = String(raw).replace(/\D/g, "");
    if (digits) candidates.add(digits);
    const code = extractUnitNameCode(String(raw));
    if (code) candidates.add(code.replace(/\D/g, ""));
  };
  add(input.unit.name);
  add(input.unit.plate);
  add(input.unit.label);
  add(String(input.unit.movilId));
  add(input.unitReferenceValue ?? null);
  // Solo del mensaje si trae contexto de unidad (no cuando el mensaje ES el km).
  if (input.message && /\b(unidad|patente|m\d{3}|od[oó]metro|odometro|hor[oó]metro)\b/i.test(input.message)) {
    add(extractUnitNameCode(input.message));
  }

  const valueDigits = String(Math.trunc(n));
  if (candidates.has(valueDigits)) return null;
  return n;
}

export async function executeCapabilities(ctx: ExecuteContext): Promise<{
  results: ToolResult[];
  state: ConversationStateV3;
  facts: string[];
}> {
  const results: ToolResult[] = [];
  let state = ctx.state;

  let caps =
    ctx.plan.requestedCapabilities.length > 0
      ? [...ctx.plan.requestedCapabilities]
      : inferDefaultCapabilities(ctx.plan, state);

  // confirm_write: SIEMPRE asegurar el write_commit (el LLM deja caps basura y
  // antes no se inyectaba certificate.issue → loop de "confirmación explícita").
  if (
    ctx.plan.conversationalAct === "confirm_write" ||
    ctx.plan.taskAction === "confirm"
  ) {
    const inferred = inferDefaultCapabilities(
      { ...ctx.plan, conversationalAct: "confirm_write", requestedCapabilities: [] },
      state,
    );
    for (const c of inferred) {
      if (!caps.some((x) => x.name === c.name)) caps.push(c);
    }
    // No mezclar prepare/list en el mismo confirm
    caps = caps.filter(
      (c) =>
        c.name.endsWith(".issue") ||
        c.name.endsWith(".update") ||
        c.name === "maintenance.create" ||
        c.name === "handoff.create",
    );
    if (caps.length === 0 && inferred.length) caps = [...inferred];
  }

  // Contrato: unit_query lista flota SOLO si no estamos seleccionando una unidad.
  if (
    ctx.plan.task === "unit_query" &&
    !caps.some((c) => c.name === "unit.search") &&
    !caps.some((c) => c.name === "unit.select") &&
    !ctx.resolvedUnit
  ) {
    caps.unshift({ name: "unit.search", params: {} });
  }

  const toolFacts: string[] = [];
  const selectingUnit = caps.some((c) => c.name === "unit.select");
  for (const req of caps) {
    // Nunca listar flota en el mismo turno que unit.select / ref exacta de este turno.
    if (
      req.name === "unit.search" &&
      (selectingUnit || Boolean(ctx.resolvedUnit))
    ) {
      continue;
    }
    const pendingBefore = state.pendingWrite;
    const r = await runOne(req, {
      ...ctx,
      state,
      resolvedUnit: ctx.resolvedUnit ?? state.unit,
    });
    results.push(r);
    toolFacts.push(...r.facts);
    if (r.data?.statePatch && typeof r.data.statePatch === "object") {
      state = { ...state, ...(r.data.statePatch as Partial<ConversationStateV3>) };
    }

    const messageId = ctx.messageId?.trim() || `v3_${randomUUID().slice(0, 12)}`;
    // Prepare → awaiting en Prisma (paridad V2 ledger)
    if (
      state.pendingWrite &&
      state.pendingWrite.operationId !== pendingBefore?.operationId
    ) {
      void syncV3PendingWriteToFrontend({
        state,
        pendingWrite: state.pendingWrite,
        messageId,
        phase: "awaiting",
        env: ctx.env,
      });
    }
    // Confirm → committed + bridge front-v2-lab
    if (r.writeAttempt && pendingBefore && !state.pendingWrite) {
      void syncV3PendingWriteToFrontend({
        state,
        pendingWrite: pendingBefore,
        messageId,
        phase: "committed",
        simulated: r.writeExecuted === false,
        env: ctx.env,
      });
    }
  }

  // Hechos de tools ganan: no mezclar unidades inventadas del responseGoal.
  const facts =
    toolFacts.length > 0
      ? toolFacts
      : [...(ctx.plan.responseGoal.facts ?? [])];

  return { results, state, facts };
}

function inferDefaultCapabilities(
  plan: TurnPlan,
  state: ConversationStateV3,
): CapabilityRequest[] {
  switch (plan.conversationalAct) {
    case "greet":
      if (!state.company && state.availableCompanies.length > 1) {
        return [{ name: "company.list", params: {} }];
      }
      if (!state.company && state.availableCompanies.length === 1) {
        return [
          {
            name: "company.select",
            params: { companyId: state.availableCompanies[0]!.id },
          },
        ];
      }
      return [];
    case "confirm_write":
      if (!state.pendingWrite) {
        // Confirmación de anomalía de lectura (pre-pendingWrite)
        if (
          state.activeTask?.collected?.anomalyCandidate != null &&
          String(state.lastQuestion?.purpose ?? "").includes("anomaly")
        ) {
          const meter =
            state.activeTask.type === "hourmeter" ? "hourmeter" : "odometer";
          return [{ name: `${meter}.prepare`, params: {} }];
        }
        return [];
      }
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
  // Lectura de flota: cualquier acto con task=unit_query implica unit.search.
  if (plan.task === "unit_query") {
    return [{ name: "unit.search", params: {} }];
  }
  // Medidor/certificado: también con inform/continue (no solo start_task).
  if (plan.task === "odometer") {
    const caps: CapabilityRequest[] = [
      { name: "odometer.prepare", params: {} },
    ];
    if (!state.unit && !plan.unitReference) {
      caps.push({ name: "unit.search", params: {} });
    }
    return caps;
  }
  if (plan.task === "hourmeter") {
    const caps: CapabilityRequest[] = [
      { name: "hourmeter.prepare", params: {} },
    ];
    if (!state.unit && !plan.unitReference) {
      caps.push({ name: "unit.search", params: {} });
    }
    return caps;
  }
  if (plan.task === "certificate") {
    return [{ name: "certificate.prepare", params: {} }];
  }
  if (
    plan.taskAction === "start" ||
    plan.taskAction === "switch" ||
    plan.conversationalAct === "start_task" ||
    plan.conversationalAct === "switch_task"
  ) {
    if (plan.task === "maintenance") return [{ name: "maintenance.prepare", params: {} }];
    if (plan.task === "human_handoff") return [{ name: "handoff.prepare", params: {} }];
    if (plan.task === "gps") return [{ name: "gps.get_status", params: {} }];
  }
  // Continuar medidor: re-prepare con campos nuevos
  if (
    (plan.conversationalAct === "continue_task" || plan.taskAction === "continue") &&
    (plan.task === "odometer" ||
      plan.task === "hourmeter" ||
      state.activeTask?.type === "odometer" ||
      state.activeTask?.type === "hourmeter")
  ) {
    const meter =
      plan.task === "hourmeter" || state.activeTask?.type === "hourmeter"
        ? "hourmeter"
        : "odometer";
    return [{ name: `${meter}.prepare`, params: {} }];
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
        const names = ctx.state.availableCompanies.map((c) => c.name).filter(Boolean);
        if (names.length === 0) {
          return {
            capability: req.name,
            ok: true,
            facts: ["Todavía no hay una empresa seleccionada en esta sesión."],
          };
        }
        if (names.length === 1) {
          const only = ctx.state.availableCompanies[0]!;
          return {
            capability: req.name,
            ok: true,
            facts: [`Seguimos con ${only.name}.`],
            data: {
              statePatch: {
                company: only,
                pendingEntity: null,
                lastQuestion: null,
              },
            },
          };
        }
        const items = ctx.state.availableCompanies.map((c, i) => ({
          index: i + 1,
          label: c.name,
          companyId: c.id,
        }));
        const lines = items.map((i) => `${i.index}. ${i.label}`).join("\n");
        return {
          capability: req.name,
          ok: true,
          facts: [
            `Todavía no hay empresa activa. Podés elegir una:\n${lines}`,
          ],
          data: {
            statePatch: {
              lastListing: {
                kind: "companies" as const,
                page: 1,
                pageSize: 20,
                totalCount: items.length,
                items,
                fetchedAt: new Date().toISOString(),
              },
              lastQuestion: {
                id: randomUUID(),
                purpose: "select_company",
                expected: "company" as const,
              },
              // Una sola expectativa dominante (XOR): campo company, no pendingEntity
              pendingEntity: null,
            },
          },
        };
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
            pendingEntity: null,
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
      const alreadyActive = ctx.state.company?.id === company.id;
      return {
        capability: req.name,
        ok: true,
        facts: alreadyActive ? [] : [`Seguimos con ${company.name}.`],
        data: {
          statePatch: {
            company,
            pendingEntity:
              ctx.state.pendingEntity?.type === "company"
                ? null
                : ctx.state.pendingEntity,
            lastQuestion:
              ctx.state.lastQuestion?.expected === "company"
                ? null
                : ctx.state.lastQuestion,
            lastListing:
              ctx.state.lastListing?.kind === "companies"
                ? null
                : ctx.state.lastListing,
          },
        },
      };
    }
    case "unit.search": {
      const pageSize = 20;
      // Solo query estructurada del TurnPlan — NUNCA el mensaje crudo (rompe "lista de unidades").
      const rawQuery = String(req.params?.query ?? "").trim();
      const query = isStructuredFleetQuery(rawQuery) ? rawQuery : "";
      const modeRaw = String(req.params?.mode ?? "").trim().toLowerCase();
      const mode =
        modeRaw === "list" || (modeRaw === "query" && query)
          ? modeRaw === "list"
            ? "list"
            : "query"
          : query
            ? "query"
            : "list";
      const filtered =
        mode === "query" && query
          ? filterFleetCacheByQuery(ctx.state, query)
          : ctx.state.fleetCache;
      const wantsGps =
        ctx.plan.task === "gps" ||
        ctx.plan.requestedCapabilities.some((c) => c.name === "gps.get_status");
      // Una sola coincidencia: fijar unidad (GPS sigue con gps.get_status; si no, preguntar)
      if (filtered.length === 1) {
        const only = filtered[0]!;
        const unit = {
          movilId: only.movilId,
          plate: only.plate,
          name: only.name,
          label: only.label,
        };
        const writingNow = ctx.plan.requestedCapabilities.some(
          (c) =>
            c.name === "odometer.prepare" ||
            c.name === "hourmeter.prepare" ||
            c.name === "certificate.prepare",
        );
        const askWhat =
          !wantsGps &&
          !writingNow &&
          ctx.plan.task !== "odometer" &&
          ctx.plan.task !== "hourmeter" &&
          ctx.plan.task !== "certificate"
            ? "¿En qué te ayudo con esta unidad? (estado/reporte, odómetro, certificado…)"
            : null;
        return {
          capability: req.name,
          ok: true,
          facts: askWhat
            ? [`Unidad: ${unit.label}.`, askWhat]
            : [`Unidad: ${unit.label}.`],
          data: {
            statePatch: {
              previousUnit:
                ctx.state.unit && ctx.state.unit.movilId !== unit.movilId
                  ? ctx.state.unit
                  : ctx.state.previousUnit,
              unit,
              pendingEntity: null,
              lastQuestion: askWhat
                ? {
                    id: randomUUID(),
                    purpose: "unit_help",
                    expected: "free_text" as const,
                  }
                : null,
              lastListing: null,
            },
          },
        };
      }
      const source =
        mode === "query" && query
          ? filtered
          : ctx.state.fleetCache;
      const items = source.slice(0, pageSize).map((u, i) => ({
        index: i + 1,
        label: u.label,
        movilId: u.movilId,
      }));
      const listing = {
        kind: "fleet" as const,
        page: 1,
        pageSize,
        totalCount: source.length,
        items,
        fetchedAt: new Date().toISOString(),
      };
      if (!ctx.state.fleetCache.length) {
        if (!ctx.state.company) {
          return {
            capability: req.name,
            ok: false,
            facts: [
              "Para listar o buscar unidades necesito que elijas la empresa primero.",
            ],
            error: "no_company",
            data: {
              statePatch: {
                lastListing: null,
                lastQuestion: {
                  id: randomUUID(),
                  purpose: "select_company",
                  expected: "company" as const,
                },
              },
            },
          };
        }
        return {
          capability: req.name,
          ok: false,
          facts: [
            `No pude cargar la flota de ${ctx.state.company.name} ahora. Probá de nuevo en un momento.`,
          ],
          error: "no_fleet",
          data: {
            statePatch: {
              lastListing: null,
              lastQuestion: {
                id: randomUUID(),
                purpose: "retry_fleet",
                expected: "unit" as const,
              },
            },
          },
        };
      }
      const scope =
        mode === "query" && query && filtered.length
          ? `coincidencias de «${query}»`
          : mode === "query" && query && !filtered.length
            ? `sin coincidencias de «${query}»`
            : "listado completo";
      const header = `Unidades en ${ctx.state.company?.name ?? "tu empresa"} (${scope}, página 1/${Math.max(1, Math.ceil(Math.max(listing.totalCount, 1) / pageSize))}, ${listing.totalCount} en total):`;
      const body = items.map((i) => `${i.index}. ${i.label}`).join("\n");
      return {
        capability: req.name,
        ok: true,
        facts: [
          items.length
            ? `${header}\n\n${body}\n\nDecime el número o la patente.`
            : `No encontré unidades${query ? ` para «${query}»` : ""} en la flota cargada.`,
        ],
        data: {
          statePatch: {
            lastListing: listing,
            lastQuestion: {
              id: randomUUID(),
              purpose: "select_unit",
              expected: "unit" as const,
            },
            pendingEntity: null,
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
      const already =
        ctx.state.unit?.movilId != null && ctx.state.unit.movilId === unit.movilId;
      const writingNow = ctx.plan.requestedCapabilities.some(
        (c) =>
          c.name === "odometer.prepare" ||
          c.name === "hourmeter.prepare" ||
          c.name === "certificate.prepare",
      );
      const askWhat =
        !writingNow &&
        ctx.plan.task !== "odometer" &&
        ctx.plan.task !== "hourmeter" &&
        ctx.plan.task !== "certificate" &&
        ctx.plan.task !== "gps"
          ? "¿En qué te ayudo con esta unidad? (estado/reporte, odómetro, certificado…)"
          : null;
      return {
        capability: req.name,
        ok: true,
        facts: already
          ? askWhat
            ? [askWhat]
            : []
          : askWhat
            ? [`Unidad: ${unit.label}.`, askWhat]
            : [`Unidad: ${unit.label}.`],
        data: {
          statePatch: {
            previousUnit:
              previousUnit && previousUnit.movilId !== unit.movilId
                ? previousUnit
                : ctx.state.previousUnit,
            unit,
            pendingEntity:
              ctx.state.pendingEntity?.type === "unit"
                ? null
                : ctx.state.pendingEntity,
            lastQuestion: askWhat
              ? {
                  id: randomUUID(),
                  purpose: "unit_help",
                  expected: "free_text" as const,
                }
              : ctx.state.lastQuestion?.expected === "unit"
                ? null
                : ctx.state.lastQuestion,
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
        return {
          capability: req.name,
          ok: false,
          facts: [
            "Para el reporte GPS necesito la patente, el número de la lista o la marca/prefijo de la unidad.",
          ],
          error: "no_unit",
          data: {
            statePatch: {
              lastQuestion: {
                id: randomUUID(),
                purpose: "unit_for_gps",
                expected: "unit" as const,
              },
              pendingEntity: null,
              activeTask: {
                type: "gps" as const,
                status: "collecting" as const,
                collected: {},
                missing: ["unit"],
              },
            },
          },
        };
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
      const q = `¿Confirmás el certificado de cobertura para ${unit.label}? ${confirmOrCancelHint()}`;
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
              pendingEntity: null,
              lastQuestion: {
                id: randomUUID(),
                purpose: "unit_for_meter",
                expected: "unit" as const,
              },
            },
          },
        };
      }
      const collected: Record<string, unknown> = {
        ...(ctx.state.activeTask?.type === meter
          ? (ctx.state.activeTask.collected ?? {})
          : {}),
        ...(ctx.plan.suppliedFields ?? {}),
      };

      // No tratar el código/patente de la unidad como km/hs.
      const cleanedValue = stripMeterValueConfusedWithUnit({
        value: collected.value,
        unit,
        message: ctx.message,
        unitReferenceValue:
          ctx.plan.unitReference?.kind === "unit"
            ? String(ctx.plan.unitReference.value ?? "")
            : null,
      });
      if (cleanedValue == null) {
        delete collected.value;
      } else {
        collected.value = cleanedValue;
      }

      // Anomalía ya pendiente + confirm_write → aceptar valor candidato
      if (
        collected.anomalyCandidate != null &&
        (ctx.plan.conversationalAct === "confirm_write" ||
          ctx.plan.taskAction === "confirm")
      ) {
        collected.value = collected.anomalyCandidate;
        delete collected.anomalyCandidate;
      }

      const still = [];
      if (collected.value == null) still.push("value");
      if (!collected.date) still.push("date");
      if (!collected.time) still.push("time");
      if (still.length) {
        // Anomalía al recibir valor (antes de pedir fecha/hora)
        if (
          still[0] !== "value" &&
          collected.value != null &&
          collected.anomalyCandidate == null
        ) {
          const prev =
            meter === "hourmeter"
              ? (ctx.state.fleetCache.find((u) => u.movilId === unit.movilId)
                  ?.hourmeter ?? null)
              : (ctx.state.fleetCache.find((u) => u.movilId === unit.movilId)
                  ?.odometer ?? null);
          if (
            isAnomalousReading({
              valueNew: Number(collected.value),
              valuePrevious: prev,
              meterType: meter === "hourmeter" ? "horometro" : "odometro",
              env: ctx.env,
            })
          ) {
            return {
              capability: req.name,
              ok: true,
              facts: [
                `${formatAnomalyQuestion(Number(collected.value), meter === "hourmeter" ? "horometro" : "odometro")} ${confirmOrCancelHint()}`,
              ],
              data: {
                statePatch: {
                  unit,
                  activeTask: {
                    type: meter as "odometer" | "hourmeter",
                    status: "collecting" as const,
                    collected: {
                      ...collected,
                      anomalyCandidate: Number(collected.value),
                      value: null,
                    },
                    missing: ["value", "date", "time"],
                  },
                  pendingEntity: null,
                  pendingWrite: null,
                  lastQuestion: {
                    id: randomUUID(),
                    purpose: `meter_anomaly_${meter}`,
                    expected: "confirmation" as const,
                  },
                },
              },
            };
          }
        }

        // Orden fijo: unidad → km/hs → fecha/hora (nunca fecha antes de km).
        const expected =
          still[0] === "value"
            ? "value"
            : still.includes("date") && still.includes("time")
              ? "date"
              : still[0] === "date"
                ? "date"
                : "time";
        const unitPrefix = `Unidad: ${unit.label}. `;
        const ask =
          expected === "value"
            ? `${unitPrefix}Pasame el valor del ${meter === "hourmeter" ? "horómetro (hs)" : "odómetro (km)"}.`
            : still.includes("date") && still.includes("time")
              ? `${unitPrefix}¿Fecha y hora de la lectura? (ej. hoy 14:30)`
              : expected === "date"
                ? `${unitPrefix}¿Qué fecha de lectura? (ej. hoy, 11/08/26)`
                : `${unitPrefix}¿A qué hora? (ej. 14:30)`;
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

      // Fecha futura → rechazar
      const today = new Date().toLocaleDateString("en-CA", {
        timeZone: "America/Argentina/Buenos_Aires",
      });
      if (
        typeof collected.date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(collected.date) &&
        collected.date > today
      ) {
        return {
          capability: req.name,
          ok: true,
          facts: [
            `La fecha ${formatDateDdMmYy(collected.date)} es futura. Pasame una fecha de lectura de hoy o anterior (ej. hoy, 11/08/26).`,
          ],
          data: {
            statePatch: {
              unit,
              activeTask: {
                type: meter as "odometer" | "hourmeter",
                status: "collecting" as const,
                collected: { ...collected, date: null },
                missing: ["date", ...(collected.time ? [] : ["time"])],
              },
              pendingWrite: null,
              lastQuestion: {
                id: randomUUID(),
                purpose: "meter_date",
                expected: "date" as const,
              },
            },
          },
        };
      }

      // Anomalía con todos los campos (por si el valor llegó junto con fecha/hora)
      const prevFull =
        meter === "hourmeter"
          ? (ctx.state.fleetCache.find((u) => u.movilId === unit.movilId)
              ?.hourmeter ?? null)
          : (ctx.state.fleetCache.find((u) => u.movilId === unit.movilId)
              ?.odometer ?? null);
      if (
        collected.anomalyCandidate == null &&
        isAnomalousReading({
          valueNew: Number(collected.value),
          valuePrevious: prevFull,
          meterType: meter === "hourmeter" ? "horometro" : "odometro",
          env: ctx.env,
        })
      ) {
        return {
          capability: req.name,
          ok: true,
          facts: [
            `${formatAnomalyQuestion(Number(collected.value), meter === "hourmeter" ? "horometro" : "odometro")} ${confirmOrCancelHint()}`,
          ],
          data: {
            statePatch: {
              unit,
              activeTask: {
                type: meter as "odometer" | "hourmeter",
                status: "collecting" as const,
                collected: {
                  ...collected,
                  anomalyCandidate: Number(collected.value),
                  value: null,
                },
                missing: ["value"],
              },
              pendingWrite: null,
              lastQuestion: {
                id: randomUUID(),
                purpose: `meter_anomaly_${meter}`,
                expected: "confirmation" as const,
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
      const dateDisp = formatDateDdMmYy(collected.date);
      const q = `¿Confirmás ${meter === "hourmeter" ? "horómetro" : "odómetro"} ${collected.value} el ${dateDisp} a las ${collected.time} en ${unit.label}? ${confirmOrCancelHint()}`;
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
              pendingEntity: null,
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
      const meta = inferMaintenanceMeta(detail);
      const payload = {
        task: "maintenance",
        movilId: unit.movilId,
        detail,
        kind: meta.kind,
        priority: meta.priority,
      };
      const operationId = `maint_${randomUUID().slice(0, 12)}`;
      const payloadHash = hashPayload(payload);
      return {
        capability: req.name,
        ok: true,
        facts: [
          `¿Confirmás el pedido de mantenimiento (${meta.kindLabel}, prioridad ${meta.priority}) para ${unit.label}? Detalle: ${detail}. ${confirmOrCancelHint()}`,
        ],
        data: {
          statePatch: {
            unit,
            activeTask: {
              type: "maintenance" as const,
              status: "awaiting_confirmation" as const,
              collected: { detail, kind: meta.kind, priority: meta.priority },
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
          `¿Confirmás generar el ticket (${categoryLabel(category)})? Motivo: ${detail}. ${confirmOrCancelHint()} (no alcanza con gracias/chau).`,
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

  // Certificado sin escritura real habilitada: decirlo y derivar a agente YA
  // (el usuario ya dijo CONFIRMO; no pedir otro CONFIRMO del ticket).
  if (name.startsWith("certificate") && !gateOk) {
    const unitLabel = ctx.state.unit?.label;
    const detail =
      `En este momento no puedo emitir el certificado` +
      (unitLabel ? ` para ${unitLabel}` : "") +
      `. Te derivo con un asesor en la plataforma`;
    const category = "certificate_escalation" as const;
    const payload = {
      task: "handoff",
      category,
      categoryLabel: categoryLabel(category),
      detail,
      unit: unitLabel ?? null,
      company: ctx.state.company?.name ?? null,
    };
    const operationId = `ticket_${randomUUID().slice(0, 12)}`;
    const handoffPw = {
      operationId,
      version: 1,
      payloadHash: hashPayload(payload),
      task: "handoff",
      summary: payload,
    };
    void syncV3PendingWriteToFrontend({
      state: ctx.state,
      pendingWrite: handoffPw,
      messageId: ctx.messageId?.trim() || `v3_${randomUUID().slice(0, 12)}`,
      phase: "committed",
      simulated: true,
      env: ctx.env,
    });
    return {
      capability: name,
      ok: true,
      facts: [
        `${detail}. Ya te pasé con un asesor; van a continuar por la plataforma.`,
      ],
      // writeAttempt false: no marcar el pendingWrite de certificado como "committed".
      writeAttempt: false,
      writeExecuted: false,
      data: {
        statePatch: {
          pendingWrite: null,
          lastQuestion: null,
          activeTask: null,
        },
      },
    };
  }

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
        `¿Confirmás el ticket (${categoryLabel(category)})? Motivo: ${detail}. ${confirmOrCancelHint()}`,
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
