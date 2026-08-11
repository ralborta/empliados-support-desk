/**
 * Clasificación de campos — minimización Fase 9.
 */
export type FieldClass =
  | "necessary"
  | "optional"
  | "sensitive"
  | "direct_identifier"
  | "quasi_identifier"
  | "forbidden";

export const FIELD_CLASSIFICATION: Record<string, FieldClass> = {
  text: "necessary",
  message_role: "necessary",
  turn_index: "necessary",
  tenant_id: "quasi_identifier",
  conversation_id: "quasi_identifier",
  external_message_id: "forbidden",
  phone: "direct_identifier",
  email: "direct_identifier",
  full_name: "direct_identifier",
  document_id: "direct_identifier",
  address: "direct_identifier",
  coordinates: "forbidden",
  password: "forbidden",
  token: "forbidden",
  api_key: "forbidden",
  private_url: "forbidden",
  internal_id: "forbidden",
  plate: "direct_identifier",
  vin: "direct_identifier",
  employee_name: "direct_identifier",
  customer_name: "direct_identifier",
  attachment: "forbidden",
  image: "forbidden",
  audio: "forbidden",
  financial: "forbidden",
  medical: "forbidden",
  legal_note: "forbidden",
  device_meta: "forbidden",
  unit_label: "optional",
  intent_hint: "optional",
  received_at: "quasi_identifier",
};

export function isExportable(cls: FieldClass): boolean {
  return cls === "necessary" || cls === "optional" || cls === "quasi_identifier";
}

export function assertNoForbiddenKeys(record: Record<string, unknown>): void {
  for (const k of Object.keys(record)) {
    const cls = FIELD_CLASSIFICATION[k] ?? "sensitive";
    if (cls === "forbidden" || cls === "direct_identifier") {
      throw new Error(`forbidden_field_present:${k}`);
    }
  }
}
