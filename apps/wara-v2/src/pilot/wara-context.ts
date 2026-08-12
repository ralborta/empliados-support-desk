/**
 * Resolución piloto V2 con WARA read-only + estado Odoo.
 * Mutaciones WARA/Odoo siguen deshabilitadas.
 */
import {
  consultarEstadoUnidades,
  createChatBotToken,
  isWaraReadConfigured,
  obtenerEmpresaPorNumero,
} from "./wara-client.js";
import {
  buildCompanyMenuMessage,
  buildCompanyResetMessage,
  buildCompanyStatusReply,
  formatUnitsList,
} from "./wara-format.js";
import {
  looksLikeChangeCompanyRequest,
  looksLikeCompanyListQuestion,
  looksLikeCompanySelection,
  looksLikeUnitsListRequest,
  matchCompanySelection,
} from "./wara-intents.js";
import { getOdooConfigStatus } from "./odoo-status.js";
import {
  clearPilotWaraSession,
  getPilotWaraSession,
  initPilotWaraSession,
  savePilotWaraSession,
} from "./wara-session.js";
import type { PilotWaraSession, WaraPromptSnapshot } from "./wara-types.js";

export type PilotWaraResolution =
  | { kind: "reply"; message: string }
  | {
      kind: "llm";
      session: PilotWaraSession;
      snapshot: WaraPromptSnapshot;
    };

function requiresCompanySelection(session: PilotWaraSession): boolean {
  return session.contacts.length > 1 && session.selectedContactId == null;
}

async function ensureSessionToken(
  session: PilotWaraSession,
  env: NodeJS.ProcessEnv,
): Promise<PilotWaraSession> {
  if (session.sessionToken && session.selectedContactId != null) return session;

  if (session.contacts.length === 1 && session.selectedContactId == null) {
    const c = session.contacts[0]!;
    const created = await createChatBotToken(c.id, env);
    if (created.ok && created.sessionToken) {
      session.selectedContactId = c.id;
      session.companyName = c.empresa || c.nombre;
      session.sessionToken = created.sessionToken;
      savePilotWaraSession(session);
    }
    return session;
  }

  if (session.selectedContactId != null && !session.sessionToken) {
    const created = await createChatBotToken(session.selectedContactId, env);
    if (created.ok && created.sessionToken) {
      session.sessionToken = created.sessionToken;
      savePilotWaraSession(session);
    }
  }
  return session;
}

async function selectCompany(
  session: PilotWaraSession,
  text: string,
  env: NodeJS.ProcessEnv,
): Promise<{ ok: boolean; message?: string }> {
  const matched = matchCompanySelection(text, session.contacts);
  if (!matched) {
    return {
      ok: false,
      message:
        `No reconocí esa opción.\n\n${buildCompanyMenuMessage(session.contacts)}`,
    };
  }
  const created = await createChatBotToken(matched.id, env);
  if (!created.ok || !created.sessionToken) {
    return {
      ok: false,
      message:
        "No pude abrir sesión en Wara para esa empresa. Probá de nuevo en un momento.",
    };
  }
  session.selectedContactId = matched.id;
  session.companyName = matched.empresa || matched.nombre;
  session.sessionToken = created.sessionToken;
  savePilotWaraSession(session);
  return {
    ok: true,
    message: `Perfecto, sigo con ${session.companyName}. ¿En qué te puedo ayudar?`,
  };
}

async function buildSnapshot(
  session: PilotWaraSession,
  env: NodeJS.ProcessEnv,
): Promise<WaraPromptSnapshot> {
  const odoo = getOdooConfigStatus(env);
  let units_preview: string[] = [];
  if (session.sessionToken) {
    const fleet = await consultarEstadoUnidades(session.sessionToken, env);
    if (fleet.ok) {
      units_preview = fleet.unidades.slice(0, 8).map((u) => {
        const p = u.patente?.trim() || "";
        const n = u.unidad?.trim() || "";
        return p && n ? `${p} (${n})` : p || n;
      });
    }
  }
  return {
    wara_configured: isWaraReadConfigured(env),
    odoo_configured: odoo.configured,
    company_name: session.companyName,
    customer_name: session.customerName,
    contacts_count: session.contacts.length,
    units_preview,
    requires_company_selection: requiresCompanySelection(session),
  };
}

export async function resolvePilotWaraTurn(input: {
  phone: string;
  text: string;
  env?: NodeJS.ProcessEnv;
}): Promise<PilotWaraResolution> {
  const env = input.env ?? process.env;
  const text = input.text.trim() || "Hola";

  if (!isWaraReadConfigured(env)) {
    return {
      kind: "llm",
      session: initPilotWaraSession(input.phone, [], null),
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

  let session =
    getPilotWaraSession(input.phone) ??
    initPilotWaraSession(
      input.phone,
      lookup.contactos,
      lookup.customerName ?? null,
    );

  if (session.contacts.length !== lookup.contactos.length) {
    session.contacts = lookup.contactos;
    savePilotWaraSession(session);
  }

  if (looksLikeChangeCompanyRequest(text)) {
    clearPilotWaraSession(input.phone);
    session = initPilotWaraSession(
      input.phone,
      lookup.contactos,
      lookup.customerName ?? null,
    );
    return { kind: "reply", message: buildCompanyResetMessage(lookup.contactos) };
  }

  if (requiresCompanySelection(session)) {
    if (looksLikeCompanySelection(text)) {
      const sel = await selectCompany(session, text, env);
      return { kind: "reply", message: sel.message ?? "Listo." };
    }
    return {
      kind: "reply",
      message: buildCompanyMenuMessage(session.contacts),
    };
  }

  session = await ensureSessionToken(session, env);

  if (looksLikeCompanyListQuestion(text)) {
    return {
      kind: "reply",
      message: buildCompanyStatusReply(session.companyName, session.contacts),
    };
  }

  if (looksLikeUnitsListRequest(text)) {
    if (!session.sessionToken) {
      return {
        kind: "reply",
        message: "Primero elegí la empresa con la que querés operar.",
      };
    }
    const fleet = await consultarEstadoUnidades(session.sessionToken, env);
    if (!fleet.ok) {
      return {
        kind: "reply",
        message:
          fleet.error ??
          "No pude consultar las unidades en Wara. Probá de nuevo en un momento.",
      };
    }
    return { kind: "reply", message: formatUnitsList(fleet.unidades) };
  }

  const snapshot = await buildSnapshot(session, env);
  return { kind: "llm", session, snapshot };
}

export { resetPilotWaraSessionsForTests } from "./wara-session.js";
