/**
 * Consultas laterales tipadas durante trámite activo o CONFIRMO pendiente.
 * Sin heurística genérica (? / quiero): solo patrones explícitos ya validados.
 */
import type { PrismaClient } from "@prisma/client";
import type { PendingActionRecord } from "@/lib/pendingAction";
import { buildInfoGuideReply, detectInfoGuideKind } from "@/lib/infoGuideReplies";
import {
  buildCompanyMenuPayload,
  buildCompanyStatusReply,
  looksLikeCompanyListQuestion,
  resolveCustomerByWaraPhone,
} from "@/lib/waraApi";
import {
  hasPendingCertificateConfirmation,
  hasPendingMantenimientoConfirmation,
  hasPendingOdometerConfirmation,
  threadHasActiveOdometerFlow,
  threadOdometerRegistrationCompleted,
} from "@/lib/wara";
import { threadHasInconclusiveTramite } from "@/lib/tramiteFlowControl";
import { normalizeWhatsAppPhone } from "@/lib/whatsappPhone";
import { isOperationalOdometerFlowMessage } from "@/lib/pendingConfirmStance";

export type TypedLateralKind =
  | "company_status"
  | "platform_opciones"
  | "platform_unidades"
  | "platform_mantenimiento";

/** Clasificación cerrada — no usar looksLikeCustomerConsultationMessage. */
export function classifyTypedLateralQuery(text: string | undefined | null): TypedLateralKind | null {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 220) return null;
  if (looksLikeCompanyListQuestion(raw)) return "company_status";
  const guide = detectInfoGuideKind(raw);
  if (guide === "opciones") return "platform_opciones";
  if (guide === "unidades") return "platform_unidades";
  if (guide === "mantenimiento") return "platform_mantenimiento";
  return null;
}

/** Trámite en curso o CONFIRMO pendiente: lateral es overlay, no reemplazo. */
export function tramiteAllowsTypedLateralOverlay(
  threadText: string,
  pendingAction: PendingActionRecord | null,
): boolean {
  if (hasPendingOdometerConfirmation(threadText)) return true;
  if (hasPendingCertificateConfirmation(threadText)) return true;
  if (hasPendingMantenimientoConfirmation(threadText)) return true;
  if (threadHasActiveOdometerFlow(threadText) && !threadOdometerRegistrationCompleted(threadText)) {
    return true;
  }
  if (
    pendingAction?.type === "odometro" ||
    pendingAction?.type === "certificados" ||
    pendingAction?.type === "mantenimiento"
  ) {
    return true;
  }
  return threadHasInconclusiveTramite(threadText, pendingAction);
}

export async function buildTypedLateralReply(
  prisma: PrismaClient,
  rawPhone: string,
  kind: TypedLateralKind,
  customerText: string,
): Promise<string> {
  if (kind === "company_status") {
    const resolution = await resolveCustomerByWaraPhone(prisma, rawPhone);
    const contacts = resolution.lookup?.contactos ?? [];
    const activeCompany =
      resolution.selectedCompanyName?.trim() ||
      resolution.customer?.companyName?.trim() ||
      "";
    const normalized = normalizeWhatsAppPhone(rawPhone);
    const menu = contacts.length
      ? await buildCompanyMenuPayload(contacts, normalized)
      : null;
    return buildCompanyStatusReply(
      activeCompany,
      contacts.length,
      menu?.waraContactsText ?? "",
    );
  }
  const guideKind =
    kind === "platform_opciones"
      ? "opciones"
      : kind === "platform_unidades"
        ? "unidades"
        : "mantenimiento";
  return buildInfoGuideReply(customerText, guideKind);
}

export function shouldSkipTypedLateralForOdometerFlow(selectionText: string, threadText: string): boolean {
  return isOperationalOdometerFlowMessage(selectionText, threadText);
}
