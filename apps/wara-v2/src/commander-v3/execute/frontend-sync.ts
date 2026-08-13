/**
 * Sincroniza escrituras Commander V3 → Prisma Operation + bridge front-v2-lab.
 * Paridad con pilot-operation-sync / invokeLabTicketBridge del path V2.
 */
import type { ConversationStateV3 } from "../types/state.js";
import { syncPilotOperationToPrisma } from "../../pilot/pilot-operation-sync.js";
import { invokeLabTicketBridge } from "../../pilot/pilot-bridge-sync.js";
import { createEmptyPilotState } from "../../pilot/conversation-state.js";
import type { WriteGateKind } from "../../pilot/write-gates.js";

type PendingWrite = NonNullable<ConversationStateV3["pendingWrite"]>;

function mapTaskToOpType(
  task: string,
): "update_odometer" | "issue_certificate" | "create_maintenance" | "odoo_ticket" {
  const t = task.toLowerCase();
  if (t.includes("cert")) return "issue_certificate";
  if (t.includes("maint")) return "create_maintenance";
  if (t.includes("handoff") || t.includes("ticket") || t.includes("odoo")) {
    return "odoo_ticket";
  }
  return "update_odometer";
}

function mapGate(task: string): WriteGateKind {
  const t = task.toLowerCase();
  if (t.includes("cert")) return "certificate";
  if (
    t.includes("handoff") ||
    t.includes("ticket") ||
    t.includes("maint") ||
    t.includes("odoo")
  ) {
    return "odoo";
  }
  return "odometer";
}

function toPilotState(state: ConversationStateV3) {
  const base = createEmptyPilotState({
    tenantId: state.tenantId,
    phone: state.phone,
  });
  const unit = state.unit;
  return {
    ...base,
    companyName: state.company?.name ?? null,
    selectedContactId: state.company?.contactId ?? null,
    selectedUnit: unit
      ? {
          movil_id: unit.movilId,
          patente: unit.plate ?? "",
          unidad: unit.name ?? "",
          label: unit.label,
        }
      : null,
  };
}

function titleFor(pw: PendingWrite): string {
  const t = pw.task.toLowerCase();
  if (t.includes("cert")) return "Certificado de cobertura (V3)";
  if (t.includes("handoff") || t.includes("ticket")) return "Derivación a asesor (V3)";
  if (t.includes("maint")) return "Mantenimiento (V3)";
  if (t.includes("horo")) return "Cambio de horómetro (V3)";
  return "Cambio de odómetro (V3)";
}

function messageTextFor(pw: PendingWrite, state: ConversationStateV3): string {
  const summary = pw.summary ?? {};
  const unit = state.unit?.label ?? summary.plate ?? summary.movilId ?? "sin unidad";
  return [
    `Operación ${pw.operationId}`,
    `Trámite: ${pw.task}`,
    `Unidad: ${unit}`,
    `Empresa: ${state.company?.name ?? "—"}`,
    `Payload: ${JSON.stringify(summary)}`,
  ].join("\n");
}

export async function syncV3PendingWriteToFrontend(input: {
  state: ConversationStateV3;
  pendingWrite: PendingWrite;
  messageId: string;
  phase: "awaiting" | "committed" | "cancelled";
  simulated?: boolean;
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  const { state, pendingWrite: pw, messageId, phase, env } = input;
  const pilotState = toPilotState(state);
  const opType = mapTaskToOpType(pw.task);
  const gateKind = mapGate(pw.task);
  const status =
    phase === "awaiting"
      ? ("awaiting_confirm" as const)
      : phase === "cancelled"
        ? ("cancelled" as const)
        : input.simulated
          ? ("dry_run" as const)
          : ("written" as const);

  try {
    await syncPilotOperationToPrisma({
      state: pilotState,
      operationId: pw.operationId,
      type: opType,
      gateKind,
      messageId,
      payloadHash: pw.payloadHash,
      payload: (pw.summary ?? {}) as Record<string, unknown>,
      status,
      resultSummary:
        phase === "committed"
          ? input.simulated
            ? "v3_simulated"
            : "v3_written"
          : phase === "cancelled"
            ? "v3_cancelled"
            : "v3_awaiting_confirmation",
      env,
    });
  } catch {
    // No tumbar el turno conversacional por fallo de ledger
  }

  const shouldBridge =
    phase === "committed" &&
    (opType === "odoo_ticket" ||
      opType === "update_odometer" ||
      opType === "issue_certificate" ||
      opType === "create_maintenance");

  if (!shouldBridge) return;

  try {
    await invokeLabTicketBridge({
      state: pilotState,
      operationId: pw.operationId,
      payloadHash: pw.payloadHash,
      tramite: pw.task,
      operationStatus: status,
      title: titleFor(pw),
      messageText: messageTextFor(pw, state),
      derivationReason:
        opType === "odoo_ticket"
          ? String(
              (pw.summary as Record<string, unknown>)?.detail ??
                (pw.summary as Record<string, unknown>)?.category ??
                "derivacion_v3",
            )
          : null,
      externalResult: input.simulated ? "v3_dry_run" : pw.operationId,
      collectedData: {
        ...(pw.summary as Record<string, unknown>),
        commander: "v3",
        simulated: Boolean(input.simulated),
      },
      priority: opType === "odoo_ticket" ? "NORMAL" : "LOW",
      env,
    });
  } catch {
    // idem
  }
}
