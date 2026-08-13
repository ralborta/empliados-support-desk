/**
 * Contexto WARA read-only para Commander V3 (sin path operacional V2).
 */
import {
  consultarEstadoUnidades,
  createChatBotToken,
  isWaraReadConfigured,
  obtenerEmpresaPorNumero,
} from "../../pilot/wara-client.js";
import { filterValidFleetUnits } from "../../pilot/unit-fleet.js";
import type { WaraUnidadEstado } from "../../pilot/wara-types.js";
import {
  getConversationStateV3,
  migrateSafeContextFromV2,
  saveConversationStateV3,
} from "../persistence/store.js";
import type { ConversationStateV3 } from "../types/state.js";
import type { CompanyRef } from "../types/refs.js";

export async function loadCommanderV3Context(input: {
  phone: string;
  tenantId: string;
  env: NodeJS.ProcessEnv;
}): Promise<
  | { ok: false; message: string }
  | {
      ok: true;
      contacts: Array<{ id: number; nombre: string; empresa: string }>;
      customerName: string | null;
      fleetUnits: WaraUnidadEstado[];
      state: ConversationStateV3;
    }
> {
  if (!isWaraReadConfigured(input.env)) {
    const state =
      getConversationStateV3(input.tenantId, input.phone) ??
      migrateSafeContextFromV2({
        tenantId: input.tenantId,
        phone: input.phone,
      });
    return {
      ok: true,
      contacts: [],
      customerName: null,
      fleetUnits: [],
      state,
    };
  }

  const lookup = await obtenerEmpresaPorNumero(input.phone, input.env);
  if (!lookup.ok || lookup.contactos.length === 0) {
    return {
      ok: false,
      message:
        lookup.error ??
        "No pude consultar tus empresas en Wara. Probá de nuevo en un momento.",
    };
  }

  const contacts = lookup.contactos;
  const availableCompanies: CompanyRef[] = contacts.map((c) => ({
    id: String(c.id),
    name: c.empresa || c.nombre,
    contactId: c.id,
  }));

  let state = getConversationStateV3(input.tenantId, input.phone);
  if (!state) {
    state = migrateSafeContextFromV2({
      tenantId: input.tenantId,
      phone: input.phone,
      availableCompanies,
      company:
        availableCompanies.length === 1 ? availableCompanies[0]! : null,
    });
  } else {
    state = {
      ...state,
      availableCompanies,
      company:
        state.company ??
        (availableCompanies.length === 1 ? availableCompanies[0]! : null),
    };
    saveConversationStateV3(state);
  }

  let fleetUnits: WaraUnidadEstado[] = [];
  if (state.company?.contactId != null) {
    const tok = await createChatBotToken(state.company.contactId, input.env);
    if (tok.ok && tok.sessionToken) {
      const fleet = await consultarEstadoUnidades(tok.sessionToken, input.env);
      if (fleet.ok && fleet.unidades) {
        fleetUnits = filterValidFleetUnits(fleet.unidades);
      }
    }
  }

  return {
    ok: true,
    contacts,
    customerName: lookup.customerName ?? null,
    fleetUnits,
    state,
  };
}
