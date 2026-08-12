import type { WaraEmpresaContact, WaraUnidadEstado } from "./wara-types.js";

export function formatContactsMenu(contacts: WaraEmpresaContact[]): string {
  return contacts.map((c, i) => `${i + 1}. ${c.empresa || c.nombre}`).join("\n");
}

export function buildCompanyMenuMessage(contacts: WaraEmpresaContact[]): string {
  const menu = formatContactsMenu(contacts);
  return (
    `¿Con cuál empresa seguimos?\n\n${menu}\n\n` +
    `Respondé con el número de la opción o con el nombre de la empresa.`
  );
}

export function buildCompanyResetMessage(contacts: WaraEmpresaContact[]): string {
  if (contacts.length === 0) {
    return "No encontré empresas asociadas a tu número en Wara.";
  }
  if (contacts.length === 1) {
    const c = contacts[0]!;
    return `Reinicié la empresa. Seguimos con ${c.empresa || c.nombre}. ¿En qué te puedo ayudar?`;
  }
  return (
    `Listo, reinicié la empresa y limpié el historial de conversación. ` +
    buildCompanyMenuMessage(contacts)
  );
}

export function buildCompanyStatusReply(
  activeCompany: string | null,
  contacts: WaraEmpresaContact[],
): string {
  const menu = formatContactsMenu(contacts);
  if (activeCompany) {
    return contacts.length > 1
      ? `Estás operando con ${activeCompany}.\n\nEste número también está asociado a:\n\n${menu}\n\nPara cambiar, escribí "cambiar empresa".`
      : `Estás operando con ${activeCompany}. ¿En qué te puedo ayudar?`;
  }
  return contacts.length
    ? `Este número está asociado en Wara a:\n\n${menu}\n\nElegí con el número o el nombre.`
    : "No encontré empresas asociadas a tu número en Wara.";
}

function formatPlate(patente: string): string {
  const p = patente.trim().toUpperCase();
  if (p.length >= 6 && !p.includes(" ")) {
    return `${p.slice(0, 2)} ${p.slice(2, 5)} ${p.slice(5)}`.trim();
  }
  return p;
}

function formatUnitLine(unit: WaraUnidadEstado, index: number): string {
  const plate = unit.patente?.trim() ? formatPlate(unit.patente) : "";
  const name = unit.unidad?.trim() || "";
  if (plate && name) return `${index}. ${plate} — ${name}`;
  return `${index}. ${plate || name || "sin identificar"}`;
}

export function formatUnitsList(unidades: WaraUnidadEstado[], max = 20): string {
  if (unidades.length === 0) {
    return "No encontré unidades en Wara para la empresa activa.";
  }
  const lines = unidades.slice(0, max).map((u, i) => formatUnitLine(u, i + 1));
  const extra =
    unidades.length > max ? `\n\n(…y ${unidades.length - max} más)` : "";
  return `Estas son las unidades que veo en Wara:\n\n${lines.join("\n")}${extra}\n\nDecime la patente o el nombre si querés el reporte de una.`;
}
