import { normalizeWhatsAppPhone } from "@/lib/whatsappPhone";

/** Empresa + contacto_id externo para menú multi-empresa en staging. */
export type PruebasEmpresaContacto = {
  contactoId: number;
  empresa: string;
};

/** Teléfonos de prueba/ejemplo con empresas conocidas que abren sesión en staging. */
export type PruebasContactAliasEntry = {
  phone: string;
  label: string;
  empresas: PruebasEmpresaContacto[];
};

/** WARA de referencia (Emma) + El Cacique habitual en staging. */
const STAGING_WARA: PruebasEmpresaContacto = { contactoId: 64866, empresa: "WARA" };
const STAGING_EL_CACIQUE: PruebasEmpresaContacto = {
  contactoId: 131776,
  empresa: "El Cacique S.A.",
};

const MULTI_EMPRESA_STAGING = [STAGING_WARA, STAGING_EL_CACIQUE];

/**
 * Lista editable de clientes de prueba. Solo aplica si
 * WARA_PRUEBAS_CONTACT_ALIASES_ENABLED=true en el entorno.
 *
 * No mostrar en el panel: es configuración interna del bot.
 */
export const PRUEBAS_CONTACT_ALIASES: PruebasContactAliasEntry[] = [
  { phone: "5491133788190", label: "Raúl", empresas: MULTI_EMPRESA_STAGING },
  { phone: "5492612478856", label: "Emi", empresas: MULTI_EMPRESA_STAGING },
  { phone: "5492613867127", label: "Lucas", empresas: MULTI_EMPRESA_STAGING },
  { phone: "5492614696353", label: "Admin Wara", empresas: MULTI_EMPRESA_STAGING },
  { phone: "5492616930141", label: "Prueba staging", empresas: MULTI_EMPRESA_STAGING },
  { phone: "542616930141", label: "Prueba staging (sin 9)", empresas: MULTI_EMPRESA_STAGING },
];

function pruebasAliasesEnabledByEnv(): boolean {
  const v = process.env.WARA_PRUEBAS_CONTACT_ALIASES_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "si";
}

export function isPruebasContactAliasesActive(): boolean {
  return pruebasAliasesEnabledByEnv() && PRUEBAS_CONTACT_ALIASES.length > 0;
}

let cachedMap: Map<string, PruebasEmpresaContacto[]> | null = null;

function pruebasContactAliasesMap(): Map<string, PruebasEmpresaContacto[]> {
  if (cachedMap) return cachedMap;
  const map = new Map<string, PruebasEmpresaContacto[]>();
  for (const entry of PRUEBAS_CONTACT_ALIASES) {
    const phone = normalizeWhatsAppPhone(entry.phone);
    if (phone.length >= 8 && entry.empresas.length > 0) {
      map.set(phone, entry.empresas);
    }
  }
  cachedMap = map;
  return map;
}

export function resolvePruebasContactAliases(rawPhone: string): PruebasEmpresaContacto[] | null {
  if (!isPruebasContactAliasesActive()) return null;

  const map = pruebasContactAliasesMap();
  const n = normalizeWhatsAppPhone(rawPhone);
  if (!n) return null;
  if (map.has(n)) return map.get(n)!;

  if (n.startsWith("549")) {
    const without9 = "54" + n.slice(3);
    if (map.has(without9)) return map.get(without9)!;
  } else if (n.startsWith("54")) {
    const with9 = "549" + n.slice(2);
    if (map.has(with9)) return map.get(with9)!;
  }
  return null;
}

export function pruebasContactAliasesSummary(): {
  enabled: boolean;
  entries: number;
  phones: string[];
} {
  return {
    enabled: isPruebasContactAliasesActive(),
    entries: PRUEBAS_CONTACT_ALIASES.length,
    phones: PRUEBAS_CONTACT_ALIASES.map((e) => normalizeWhatsAppPhone(e.phone)),
  };
}
