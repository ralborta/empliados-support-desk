/** Referencias de entidad V3 — sin semántica de mensaje. */

export type CompanyRef = {
  id: string;
  name: string;
  contactId?: number | null;
};

export type UnitRef = {
  movilId: number;
  plate: string | null;
  name: string | null;
  label: string;
};

export type EntityRef = CompanyRef | UnitRef;

export type EntityReference = {
  kind: "company" | "unit";
  /** plate | unit_name | index | contextual | named_company */
  mode: "plate" | "unit_name" | "index" | "contextual" | "named" | "id";
  value: string;
  reference?: "active" | "previous" | "listed" | null;
};
