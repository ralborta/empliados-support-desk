/**
 * Alias de contactos de prueba para lab/shadow.
 * Formato env WARA_TEST_CONTACT_ALIASES:
 *   5491133788190=64866:WARA,131776:El Cacique S.A.|5492612478856=64866:WARA,...
 *
 * Wara a veces devuelve contacto_id que no abren sesión (CreateChatBotToken
 * → "Contacto inexistente"). Este mapa fuerza los IDs operativos.
 */
import type { WaraEmpresaContact } from "./wara-types.js";

function digitsPhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

export type AliasEmpresa = { contactoId: number; empresa: string };

export function parseTestContactAliases(
  raw: string | undefined,
): Map<string, AliasEmpresa[]> {
  const map = new Map<string, AliasEmpresa[]>();
  const src = (raw ?? "").trim();
  if (!src) return map;

  for (const phoneBlock of src.split("|")) {
    const trimmed = phoneBlock.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const phone = digitsPhone(trimmed.slice(0, eq));
    const empresasRaw = trimmed.slice(eq + 1);
    if (phone.length < 8) continue;
    const empresas: AliasEmpresa[] = [];
    for (const part of empresasRaw.split(",")) {
      const p = part.trim();
      if (!p) continue;
      const colon = p.indexOf(":");
      if (colon <= 0) continue;
      const id = Number(p.slice(0, colon).trim());
      const empresa = p.slice(colon + 1).trim();
      if (!Number.isFinite(id) || id <= 0 || !empresa) continue;
      empresas.push({ contactoId: id, empresa });
    }
    if (empresas.length) map.set(phone, empresas);
  }
  return map;
}

export function resolveTestContactAliases(
  rawPhone: string,
  env: NodeJS.ProcessEnv = process.env,
): AliasEmpresa[] | null {
  const enabled = (env.WARA_TEST_CONTACT_ALIASES_ENABLED ?? "true")
    .trim()
    .toLowerCase();
  if (enabled === "0" || enabled === "false" || enabled === "no") return null;

  const map = parseTestContactAliases(env.WARA_TEST_CONTACT_ALIASES);
  if (map.size === 0) return null;

  const n = digitsPhone(rawPhone);
  if (!n) return null;
  if (map.has(n)) return map.get(n)!;
  if (n.startsWith("549")) {
    const without9 = `54${n.slice(3)}`;
    if (map.has(without9)) return map.get(without9)!;
  } else if (n.startsWith("54") && !n.startsWith("549")) {
    const with9 = `549${n.slice(2)}`;
    if (map.has(with9)) return map.get(with9)!;
  }
  return null;
}

export function applyTestContactAliasesToContacts(
  rawPhone: string,
  contactos: WaraEmpresaContact[],
  env: NodeJS.ProcessEnv = process.env,
): WaraEmpresaContact[] {
  const aliases = resolveTestContactAliases(rawPhone, env);
  if (!aliases?.length) return contactos;

  const nameHint =
    contactos.find((c) => c.nombre.trim())?.nombre.trim() || "";
  return aliases.map((a) => ({
    id: a.contactoId,
    empresa: a.empresa,
    nombre: nameHint || a.empresa,
  }));
}
