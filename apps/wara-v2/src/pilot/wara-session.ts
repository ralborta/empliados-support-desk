import type { PilotWaraSession, WaraEmpresaContact } from "./wara-types.js";
import { normalizeWaraPhone } from "./wara-client.js";

const sessions = new Map<string, PilotWaraSession>();

export function getPilotWaraSession(phone: string): PilotWaraSession | null {
  const key = normalizeWaraPhone(phone);
  return sessions.get(key) ?? null;
}

export function savePilotWaraSession(session: PilotWaraSession): void {
  sessions.set(normalizeWaraPhone(session.phone), session);
}

export function clearPilotWaraSession(phone: string): void {
  sessions.delete(normalizeWaraPhone(phone));
}

export function initPilotWaraSession(
  phone: string,
  contacts: WaraEmpresaContact[],
  customerName: string | null,
): PilotWaraSession {
  const session: PilotWaraSession = {
    phone,
    contacts,
    selectedContactId: null,
    companyName: null,
    sessionToken: null,
    customerName,
  };
  savePilotWaraSession(session);
  return session;
}

/** Solo tests — no usar en producción. */
export function resetPilotWaraSessionsForTests(): void {
  sessions.clear();
}
