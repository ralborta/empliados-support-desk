/**
 * Flujo determinístico certificado de cobertura V2 — lab, sin escrituras reales por defecto.
 */
import type { PilotConversationState } from "./conversation-state.js";
import type { CertificateDraft } from "./certificate-types.js";
import {
  looksLikeCancelCertificate,
  looksLikeCertificateIntent,
  resolveCertificateType,
} from "./certificate-core.js";
import {
  looksLikeExplicitConfirm,
  looksLikeExplicitReject,
} from "./odometer-core.js";
import {
  looksLikeBriefConfirmation,
  looksLikeBriefRejection,
  looksLikeGpsReportRequest,
  looksLikePendingConfirmComprehensionAck,
  looksLikeResumePausedTramite,
} from "./brief-replies.js";
import {
  buildCertificateOperationRecord,
  createCertificateOperationId,
  findCertificateByConfirmMessageId,
  findCertificateByPayloadHash,
  hashCertificatePayload,
} from "./certificate-operation.js";
import { issueCertificadoCobertura } from "./certificate-wara.js";
import { toFleetUnitRef } from "./unit-fleet.js";
import type { WaraUnidadEstado } from "./wara-types.js";
import { isPilotDryRun } from "./write-gates.js";
import { syncPilotOperationToPrisma } from "./pilot-operation-sync.js";
import { isInsideUnifiedBrainContext } from "./semantic/reclass-guard.js";

export type CertificateTurnResult =
  | { kind: "none" }
  | { kind: "reply"; message: string; state: PilotConversationState }
  | { kind: "gps_side"; text: string; state: PilotConversationState };

export type CertificateWriteDeps = {
  issue?: (input: {
    sessionToken: string;
    patente: string;
    dryRun: boolean;
  }) => Promise<{ ok: boolean; error?: string; summary?: string; url?: string; payload?: Record<string, unknown> }>;
};

let testDeps: CertificateWriteDeps | undefined;

export function setCertificateWriteDepsForTests(deps: CertificateWriteDeps | undefined): void {
  testDeps = deps;
}

function emptyDraft(): CertificateDraft {
  return { unit: null, step: "idle" };
}

function buildConfirmQuestion(unitLabel: string): string {
  return (
    `Puedo solicitar el certificado de cobertura de ${unitLabel}.\n` +
    `¿Querés que lo genere?\n\n` +
    `Si está correcto, respondé CONFIRMO.`
  );
}

async function executeIssue(
  state: PilotConversationState,
  draft: CertificateDraft,
  messageId: string,
  env: NodeJS.ProcessEnv,
): Promise<CertificateTurnResult> {
  if (!draft.unit) return { kind: "reply", message: "Falta la unidad.", state };
  if (!state.sessionToken) return { kind: "reply", message: "No hay sesión WARA activa.", state };

  const payloadHash = hashCertificatePayload({
    tenantId: state.tenantId,
    phone: state.phone,
    patente: draft.unit.patente,
  });

  const dup = findCertificateByPayloadHash(state.certificateOperations ?? {}, payloadHash);
  if (dup) return { kind: "reply", message: "Ese certificado ya fue procesado (idempotencia).", state };

  const dupConfirm = findCertificateByConfirmMessageId(state.certificateOperations ?? {}, messageId);
  if (dupConfirm) return { kind: "reply", message: "Este CONFIRMO ya fue procesado.", state };

  const dryRun = isPilotDryRun("certificate", env);
  const operationId = createCertificateOperationId();

  let result: { ok: boolean; error?: string; summary?: string; url?: string; payload?: Record<string, unknown> };
  if (testDeps?.issue) {
    result = await testDeps.issue({
      sessionToken: state.sessionToken,
      patente: draft.unit.patente,
      dryRun,
    });
  } else {
    const wara = await issueCertificadoCobertura(
      { sessionToken: state.sessionToken, patente: draft.unit.patente },
      env,
    );
    result = wara.ok
      ? { ok: true, summary: wara.summary, url: wara.dryRun ? undefined : wara.url, payload: wara.payload as Record<string, unknown> }
      : { ok: false, error: wara.error, payload: wara.payload as Record<string, unknown> };
  }

  const record = buildCertificateOperationRecord({
    operationId,
    messageId,
    tenantId: state.tenantId,
    phone: state.phone,
    unit: draft.unit,
    stateVersion: state.stateVersion,
    status: result.ok ? (dryRun ? "dry_run" : "written") : "failed",
    confirmMessageId: messageId,
    waraPayload: result.payload ?? null,
    deliveryUrl: result.url ?? null,
    resultSummary: result.ok ? (result.summary ?? null) : (result.error ?? null),
  });

  if (!state.certificateOperations) state.certificateOperations = {};
  state.certificateOperations[operationId] = record;

  void syncPilotOperationToPrisma({
    state,
    operationId,
    type: "issue_certificate",
    gateKind: "certificate",
    messageId,
    payloadHash: record.payloadHash,
    payload: (record.waraPayload ?? {}) as Record<string, unknown>,
    status: record.status,
    externalReference: record.deliveryUrl,
    resultSummary: record.resultSummary,
    env,
  });

  state.certificateDraft = null;
  state.pendingConfirmation = null;
  state.activeTramite = "none";
  state.step = "idle";

  if (!result.ok) {
    return {
      kind: "reply",
      message: result.error ?? "WARA no pudo generar el certificado. ¿Querés que derive a un operador?",
      state,
    };
  }

  return {
    kind: "reply",
    message: dryRun
      ? `[Lab] Certificado simulado OK — ${draft.unit.label}. Sin escritura real en WARA.`
      : result.url
        ? `Listo, certificado: ${result.url}`
        : `Listo, certificado generado para ${draft.unit.label}.`,
    state,
  };
}

function resolveUnit(
  state: PilotConversationState,
  text: string,
  fleetUnits: WaraUnidadEstado[],
): CertificateDraft["unit"] {
  if (state.selectedUnit) return state.selectedUnit;
  const plateNorm = text.replace(/\s+/g, "").toUpperCase();
  for (const u of fleetUnits) {
    const p = (u.patente ?? "").replace(/\s+/g, "").toUpperCase();
    if (p.length >= 6 && plateNorm.includes(p)) return toFleetUnitRef(u);
  }
  return null;
}

export async function tryResolveCertificateTurn(input: {
  state: PilotConversationState;
  text: string;
  messageId: string;
  env: NodeJS.ProcessEnv;
  fleetUnits: WaraUnidadEstado[];
}): Promise<CertificateTurnResult> {
  const { state, text, messageId, env } = input;
  const unified = isInsideUnifiedBrainContext();
  const activeCert =
    state.activeTramite === "certificate_issue" ||
    (state.certificateDraft && state.certificateDraft.step !== "idle") ||
    state.pendingConfirmation?.action === "certificate_issue";

  // Con cerebro unificado la intención ya está autorizada por TurnDecision (no looksLike*).
  if (!activeCert && !unified && !looksLikeCertificateIntent(text)) return { kind: "none" };

  if (!state.certificateDraft) state.certificateDraft = emptyDraft();
  if (!state.certificateOperations) state.certificateOperations = {};
  const draft = state.certificateDraft;
  if (!unified) resolveCertificateType(text);

  if (!unified && looksLikeCancelCertificate(text)) {
    state.certificateDraft = emptyDraft();
    state.pendingConfirmation = null;
    state.activeTramite = "none";
    state.step = "idle";
    // Conservar selectedUnit — cancelar solo el certificado.
    return { kind: "reply", message: "Cancelé el trámite de certificado. La unidad sigue activa. ¿En qué más te ayudo?", state };
  }

  if (
    state.pendingConfirmation?.action === "certificate_issue" &&
    looksLikeGpsReportRequest(text)
  ) {
    return { kind: "gps_side", text, state };
  }

  if (
    state.pendingConfirmation?.action === "certificate_issue" &&
    (looksLikeResumePausedTramite(text) || looksLikePendingConfirmComprehensionAck(text))
  ) {
    return {
      kind: "reply",
      message: `Dale. ${state.pendingConfirmation.question}`,
      state,
    };
  }

  if (state.pendingConfirmation?.action === "certificate_issue") {
    if (looksLikeExplicitReject(text) || looksLikeBriefRejection(text)) {
      state.pendingConfirmation = null;
      draft.step = "await_unit";
      return { kind: "reply", message: "Ok, no genero el certificado. Decime otra unidad si querés.", state };
    }
    if (looksLikeExplicitConfirm(text) || looksLikeBriefConfirmation(text)) {
      return executeIssue(state, draft, messageId, env);
    }
  }

  if (draft.step === "idle") {
    state.activeTramite = "certificate_issue";
    draft.step = state.selectedUnit ? "await_confirm" : "await_unit";
    if (state.selectedUnit) {
      draft.unit = state.selectedUnit;
    }
  }

  if (draft.step === "await_unit") {
    const unit = resolveUnit(state, text, input.fleetUnits);
    if (!unit) {
      return {
        kind: "reply",
        message: "Decime la patente de la unidad para el certificado de cobertura.",
        state,
      };
    }
    draft.unit = unit;
    state.selectedUnit = unit;
    draft.step = "await_confirm";
  }

  if (draft.step === "await_confirm" && draft.unit) {
    const q = buildConfirmQuestion(draft.unit.label);
    state.pendingConfirmation = {
      action: "certificate_issue",
      unit: draft.unit,
      askedAt: new Date().toISOString(),
      question: q,
      operationId: createCertificateOperationId(),
    };
    draft.step = "await_confirm";
    if (looksLikeExplicitConfirm(text) || looksLikeBriefConfirmation(text)) {
      return executeIssue(state, draft, messageId, env);
    }
    return { kind: "reply", message: q, state };
  }

  return { kind: "none" };
}
