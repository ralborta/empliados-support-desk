/**
 * Intérprete tipado de turno conversacional V2 (antes de herramientas).
 */
import { z } from "zod";
import { classifyServiceIntent, looksLikeOperationalServiceIntent } from "./service-catalog.js";
import { interpretUnitSearchRules } from "./unit-search-semantics.js";
import {
  looksLikeBriefConfirmation,
  looksLikeBriefRejection,
  looksLikeCancelTramite,
  looksLikeChangeUnit,
  looksLikeGpsReportRequest,
  looksLikeResumeTramite,
} from "./brief-replies.js";
import {
  fechaLecturaTieneHora,
  looksLikeClockTimeOnlyMessage,
  parseFechaFromText,
} from "./odometro-fecha.js";
import type { PaginatedFleetListing } from "./unit-fleet.js";
import type { FleetUnitRef } from "./unit-fleet.js";

export const SemanticTurnSchema = z.object({
  intent: z.enum([
    "unit_list",
    "unit_search",
    "unit_status",
    "gps_report",
    "odometer_update",
    "horometer_update",
    "maintenance",
    "certificate",
    "ticket",
    "human_handoff",
    "continue",
    "cancel",
    "confirmation",
    "correction",
    "general",
    "unclear",
  ]),
  confidence: z.number().min(0).max(1),
  entity: z
    .object({
      type: z.enum(["license_plate", "unit_name", "index"]).optional(),
      value: z.string().optional(),
      matchMode: z.enum(["exact", "prefix", "suffix", "contains"]).optional(),
    })
    .optional(),
  fields: z
    .object({
      value: z.number().optional(),
      date: z.string().optional(),
      time: z.string().optional(),
      timezone: z.string().optional(),
      certificateType: z.string().optional(),
      maintenanceType: z.string().optional(),
      detail: z.string().optional(),
    })
    .optional(),
  references: z
    .object({
      useActiveUnit: z.boolean().optional(),
      usePreviousList: z.boolean().optional(),
      usePendingTramite: z.boolean().optional(),
    })
    .optional(),
  temporal: z
    .object({
      raw: z.string().optional(),
      resolvedDate: z.string().optional(),
      resolvedTime: z.string().optional(),
      resolution: z.enum(["exact", "relative", "contextual"]).optional(),
      ambiguous: z.boolean().optional(),
    })
    .optional(),
});

export type SemanticTurn = z.infer<typeof SemanticTurnSchema>;

export type SemanticTurnContext = {
  lastListing?: PaginatedFleetListing | null;
  selectedUnit?: FleetUnitRef | null;
  listingFresh?: boolean;
  activeTramite?: string | null;
  lastAgentQuestion?: string | null;
  timezone?: string;
};

const TZ = "America/Argentina/Buenos_Aires";

export function interpretSemanticTurn(text: string, ctx: SemanticTurnContext = {}): SemanticTurn {
  const raw = text.trim();
  const tz = ctx.timezone ?? TZ;

  if (looksLikeCancelTramite(raw)) {
    return SemanticTurnSchema.parse({ intent: "cancel", confidence: 0.95 });
  }
  if (looksLikeBriefConfirmation(raw)) {
    return SemanticTurnSchema.parse({ intent: "confirmation", confidence: 0.95 });
  }
  if (looksLikeBriefRejection(raw) || looksLikeChangeUnit(raw)) {
    return SemanticTurnSchema.parse({ intent: "correction", confidence: 0.9 });
  }
  if (looksLikeResumeTramite(raw)) {
    return SemanticTurnSchema.parse({
      intent: "continue",
      confidence: 0.9,
      references: { usePendingTramite: true },
    });
  }

  const service = classifyServiceIntent(raw);
  if (service === "certificate") {
    return SemanticTurnSchema.parse({
      intent: "certificate",
      confidence: 0.95,
      fields: { certificateType: "cobertura" },
      references: { useActiveUnit: true },
    });
  }
  if (service === "odometer_update" || service === "horometer_update") {
    return SemanticTurnSchema.parse({
      intent: service,
      confidence: 0.95,
      references: { useActiveUnit: true },
    });
  }
  if (service === "maintenance") {
    return SemanticTurnSchema.parse({
      intent: "maintenance",
      confidence: 0.9,
      references: { useActiveUnit: true },
    });
  }
  if (service === "ticket" || service === "human_handoff") {
    return SemanticTurnSchema.parse({
      intent: service,
      confidence: 0.9,
    });
  }

  // Campos temporales (fecha/hora) — típico en await_fecha de odómetro.
  const fecha = parseFechaFromText(raw, tz);
  if (fecha && (ctx.activeTramite === "odometer_update" || /fecha|hora|ayer|hoy|domingo|lunes|martes|miercoles|jueves|viernes|sabado|\d{1,2}:\d{2}/i.test(raw))) {
    const hasTime = fechaLecturaTieneHora(fecha, raw) || looksLikeClockTimeOnlyMessage(raw);
    const day = fecha.slice(0, 10);
    const time = hasTime ? fecha.slice(11, 16) : undefined;
    return SemanticTurnSchema.parse({
      intent: ctx.activeTramite === "odometer_update" ? "odometer_update" : "general",
      confidence: 0.9,
      fields: {
        date: day,
        time,
        timezone: tz,
      },
      temporal: {
        raw,
        resolvedDate: day,
        resolvedTime: time,
        resolution: /\b(hoy|ayer|anteayer|domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/i.test(raw)
          ? "relative"
          : "exact",
        ambiguous: false,
      },
      references: { usePendingTramite: true },
    });
  }

  if (looksLikeGpsReportRequest(raw) || service === "gps_report") {
    const unit = interpretUnitSearchRules(raw, {
      lastListing: ctx.lastListing,
      selectedUnit: ctx.selectedUnit,
      listingFresh: ctx.listingFresh,
    });
    return SemanticTurnSchema.parse({
      intent: unit ? "unit_status" : "gps_report",
      confidence: 0.85,
      entity: unit
        ? {
            type: unit.entity === "unit_name" ? "unit_name" : "license_plate",
            value: unit.query,
            matchMode:
              unit.matchMode === "index" || unit.matchMode === "contextual"
                ? "exact"
                : unit.matchMode,
          }
        : undefined,
      references: { useActiveUnit: !unit },
    });
  }

  if (looksLikeOperationalServiceIntent(raw)) {
    return SemanticTurnSchema.parse({ intent: "unclear", confidence: 0.4 });
  }

  const unit = interpretUnitSearchRules(raw, {
    lastListing: ctx.lastListing,
    selectedUnit: ctx.selectedUnit,
    listingFresh: ctx.listingFresh,
  });
  if (unit && unit.confidence !== "low") {
    return SemanticTurnSchema.parse({
      intent: unit.intent === "unit_status" ? "unit_status" : "unit_search",
      confidence: unit.confidence === "high" ? 0.9 : 0.75,
      entity: {
        type: unit.entity === "unit_name" ? "unit_name" : "license_plate",
        value: unit.query,
        matchMode:
          unit.matchMode === "index" || unit.matchMode === "contextual"
            ? "exact"
            : unit.matchMode,
      },
      references: { usePreviousList: Boolean(ctx.listingFresh) },
    });
  }

  return SemanticTurnSchema.parse({ intent: "general", confidence: 0.5 });
}

export function validateSemanticTurn(raw: unknown): SemanticTurn | null {
  const parsed = SemanticTurnSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
