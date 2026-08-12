/**
 * Resolución piloto V2 con WARA read-only + router operacional determinístico.
 * Mutaciones WARA/Odoo siguen deshabilitadas.
 */
import { isWaraReadConfigured, obtenerEmpresaPorNumero } from "./wara-client.js";
import { getOdooConfigStatus } from "./odoo-status.js";
import {
  initPilotWaraSession,
  resetPilotWaraSessionsForTests as resetLegacyPilotSessions,
} from "./wara-session.js";
import { resolveOperationalTurn } from "./operational-turn.js";
import type { PilotWaraSession, WaraPromptSnapshot } from "./wara-types.js";
import {
  resetPilotConversationStatesForTests,
  configurePilotStatePersistence,
} from "./conversation-state.js";

export type PilotWaraResolution =
  | { kind: "reply"; message: string }
  | {
      kind: "llm";
      session: PilotWaraSession;
      snapshot: WaraPromptSnapshot;
    };

export async function resolvePilotWaraTurn(input: {
  phone: string;
  text: string;
  env?: NodeJS.ProcessEnv;
  tenantId?: string;
}): Promise<PilotWaraResolution> {
  const env = input.env ?? process.env;
  const text = input.text.trim() || "Hola";
  const tenantId = (input.tenantId ?? env.WARA_V2_SHADOW_TENANT ?? "tenant_internal_ops").trim();

  if (env.WARA_V2_PILOT_STATE_PATH?.trim()) {
    configurePilotStatePersistence(env.WARA_V2_PILOT_STATE_PATH.trim());
  }

  if (!isWaraReadConfigured(env)) {
    const session = initPilotWaraSession(input.phone, [], null);
    return {
      kind: "llm",
      session,
      snapshot: {
        wara_configured: false,
        odoo_configured: getOdooConfigStatus(env).configured,
        company_name: null,
        customer_name: null,
        contacts_count: 0,
        units_preview: [],
        requires_company_selection: false,
      },
    };
  }

  const lookup = await obtenerEmpresaPorNumero(input.phone, env);
  if (!lookup.ok || lookup.contactos.length === 0) {
    return {
      kind: "reply",
      message:
        lookup.error ??
        "No pude consultar tus empresas en Wara. Probá de nuevo en un momento.",
    };
  }

  const result = await resolveOperationalTurn({
    tenantId,
    phone: input.phone,
    text,
    env,
    contacts: lookup.contactos,
    customerName: lookup.customerName ?? null,
  });

  if (result.kind === "reply" || result.kind === "duplicate") {
    return { kind: "reply", message: result.message };
  }

  const st = result.state;
  const session: PilotWaraSession = {
    phone: st.phone,
    contacts: st.contacts,
    selectedContactId: st.selectedContactId,
    companyName: st.companyName,
    sessionToken: st.sessionToken,
    customerName: st.customerName,
  };

  return { kind: "llm", session, snapshot: result.snapshot };
}

export function resetPilotWaraSessionsForTests(): void {
  resetLegacyPilotSessions();
  resetPilotConversationStatesForTests();
}

export { resetPilotConversationStatesForTests } from "./conversation-state.js";
