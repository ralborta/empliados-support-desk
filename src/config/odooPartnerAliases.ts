/**
 * Mapeo Wara / chat → partner Odoo (res.partner).
 * Evita búsquedas ambiguas (ej. "WARA" matcheando otra empresa) y alinea alias
 * del menú con la razón social exacta cargada en Odoo.
 */

export type OdooPartnerAliasEntry = {
  /** Nombre del res.partner en Odoo (búsqueda exacta). */
  odooName: string;
  /** Si se conoce, resuelve directo sin search_read por nombre. */
  partnerId?: number;
  /** Variantes desde Wara, menú WhatsApp o sesión local. */
  aliases: string[];
};

/** Lista editable: agregar entradas cuando un cliente tenga alias distintos en Wara vs Odoo. */
export const ODOO_PARTNER_ALIASES: OdooPartnerAliasEntry[] = [
  {
    odooName: "Di Ce Tours Srl, WARA DICETOURS",
    aliases: [
      "dicetour",
      "dicetour wara",
      "dicetours",
      "wara dicetours",
      "di ce tours",
      "di ce tours srl",
      "di ce tours srl wara dicetours",
    ],
  },
  {
    // Bug real, producción 2026-07-28: el partner real en Odoo se llama "El Cacique Sa"
    // (sin puntos), pero el alias buscaba "El Cacique S.A." (con puntos) — ninguna
    // búsqueda por nombre (exacta, prefijo, contiene) los reconocía como el mismo
    // registro, así que se creaba un partner NUEVO cada vez que se escalaba un ticket
    // para esta empresa (el cliente lo reportó como "está generando contactos en Odoo").
    // partnerId fijo = resuelve directo al partner real de siempre, sin depender de que
    // el nombre coincida.
    odooName: "El Cacique Sa",
    partnerId: 320,
    aliases: ["cacique", "el cacique", "el cacique sa", "el cacique s.a.", "el cacique s.a"],
  },
];

export function normOdooPartnerToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type OdooPartnerLookup = {
  odooName: string;
  partnerId?: number;
  matchedAlias: string;
};

let aliasIndex: Map<string, OdooPartnerLookup> | null = null;

function buildAliasIndex(): Map<string, OdooPartnerLookup> {
  const map = new Map<string, OdooPartnerLookup>();
  for (const entry of ODOO_PARTNER_ALIASES) {
    const odooName = entry.odooName.trim();
    if (!odooName) continue;

    const lookup: OdooPartnerLookup = {
      odooName,
      partnerId: entry.partnerId,
      matchedAlias: odooName,
    };

    const keys = new Set<string>([normOdooPartnerToken(odooName), ...entry.aliases.map(normOdooPartnerToken)]);
    for (const key of keys) {
      if (!key) continue;
      map.set(key, { ...lookup, matchedAlias: key });
    }
  }
  return map;
}

function aliasIndexMap(): Map<string, OdooPartnerLookup> {
  if (!aliasIndex) aliasIndex = buildAliasIndex();
  return aliasIndex;
}

/** Resuelve alias Wara/chat al partner canónico de Odoo, si hay entrada configurada. */
export function resolveOdooPartnerLookup(companyName?: string | null): OdooPartnerLookup | null {
  const raw = companyName?.trim();
  if (!raw) return null;
  return aliasIndexMap().get(normOdooPartnerToken(raw)) ?? null;
}

/** Nombre de empresa a usar al crear tickets Odoo (canónico si hay alias). */
export function resolveOdooPartnerCompanyName(companyName?: string | null): string {
  const raw = companyName?.trim();
  if (!raw) return "";
  return resolveOdooPartnerLookup(raw)?.odooName ?? raw;
}
