/** Metadatos V2 persistidos en rawPayload de TicketMessage (sin secretos). */
export type V2BridgePayload = {
  v2Bridge: true;
  operationId: string;
  payloadHash: string;
  tramite: string;
  tenantId: string;
  phoneE164: string;
  companyName?: string | null;
  unit?: { patente?: string; label?: string } | null;
  operationStatus: string;
  externalResult?: string | null;
  unknownOutcome?: boolean;
  reconciliationRequired?: boolean;
  collectedData?: Record<string, unknown>;
  derivationReason?: string | null;
  createdAt: string;
};

export type CreateV2BridgeTicketInput = {
  phoneE164: string;
  tenantId: string;
  contactName: string;
  companyName?: string | null;
  title: string;
  messageText: string;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  category?: "TECH_SUPPORT" | "BILLING" | "SALES" | "OTHER";
  operationId: string;
  payloadHash: string;
  tramite: string;
  operationStatus: string;
  externalResult?: string | null;
  unknownOutcome?: boolean;
  reconciliationRequired?: boolean;
  collectedData?: Record<string, unknown>;
  derivationReason?: string | null;
  unit?: { patente?: string; label?: string } | null;
};

export type CreateV2BridgeTicketResult =
  | {
      ok: true;
      ticketId: string;
      ticketCode: string;
      created: boolean;
      autoAssigned: boolean;
      idempotent: boolean;
    }
  | { ok: false; error: string; skipped?: boolean };
