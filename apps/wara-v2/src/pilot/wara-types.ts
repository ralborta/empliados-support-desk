export type WaraEmpresaContact = {
  id: number;
  nombre: string;
  empresa: string;
};

export type WaraEmpresaLookupResult = {
  configured: boolean;
  ok: boolean;
  encontrado: boolean;
  contactos: WaraEmpresaContact[];
  sessionToken?: string;
  customerId?: number;
  customerName?: string;
  status?: number;
  error?: string;
};

export type WaraUnidadEstado = {
  movil_id: number;
  unidad: string;
  patente: string;
  ultimo_reporte?: { fecha?: string; hace_segundos?: number } | null;
  ultima_posicion?: { lat?: number; lon?: number; hace_segundos?: number } | null;
  ultima_ignicion?: { estado?: boolean | string | number; hace_segundos?: number } | null;
};

export type WaraConsultarEstadoUnidadesResult = {
  ok: boolean;
  status: number;
  cliente?: string;
  unidades: WaraUnidadEstado[];
  error?: string;
};

export type PilotWaraSession = {
  phone: string;
  contacts: WaraEmpresaContact[];
  selectedContactId: number | null;
  companyName: string | null;
  sessionToken: string | null;
  customerName: string | null;
};

export type WaraPromptSnapshot = {
  wara_configured: boolean;
  odoo_configured: boolean;
  company_name: string | null;
  customer_name: string | null;
  contacts_count: number;
  units_preview: string[];
  requires_company_selection: boolean;
};
