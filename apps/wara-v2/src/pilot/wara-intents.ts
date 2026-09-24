function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function looksLikeChangeCompanyRequest(text: string): boolean {
  const t = norm(text);
  if (!t) return false;
  if (/^reiniciar(\s+de)?\s+empresa$/.test(t)) return true;
  if (/\b(reinici\w*|reset)\b/.test(t) && /\bempresa\b/.test(t)) return true;
  if (/\b(cambiar|cambio|cambia|cambiarme|otra|elegir|seleccionar)\b.*\bempresa\b/.test(t)) {
    return true;
  }
  if (/\bempresa\b.*\b(cambiar|otra|reiniciar)\b/.test(t)) return true;
  if (/\bquiero\s+cambiar\b/.test(t) && /\bempresa\b/.test(t)) return true;
  return false;
}

export function looksLikeCompanyListQuestion(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  if (/\b(que|q|cuales|cuantas|cual)\b.*\bempresa/.test(n)) return true;
  if (/\bempresa/.test(n) && /\b(tengo|asociad|lista|figur|operando)\b/.test(n)) {
    return true;
  }
  return false;
}

export function looksLikeCompanySelection(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t || t.length > 50) return false;
  if (looksLikeChangeCompanyRequest(t)) return false;
  if (looksLikeCompanyListQuestion(t)) return false;
  const n = norm(t);
  if (/^(hola|buenas|menu|ayuda|si|no|gracias)$/.test(n)) return false;
  if (/^\d{1,2}$/.test(n)) return true;
  if (/^opcion\s*\d{1,2}$/i.test(t)) return true;
  if (/^(wara|guara|el cacique|cacique)$/.test(n)) return true;
  if (n.split(/\s+/).length <= 5 && /\b(wara|guara|el cacique|cacique)\b/.test(n)) {
    return true;
  }
  return false;
}

export function looksLikeUnitsListRequest(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  if (/\b(lista|listas|listar|mostrar|ver|dame|pasame|cuales|cuantas|todas)\b/.test(n)) {
    if (/\b(unidad|unidades|movil|moviles|flota|patente|matricula|vehiculo)\b/.test(n)) {
      return true;
    }
  }
  if (/^(lista|listas|unidades|flota)$/.test(n)) return true;
  if (/\blistas?\s+de\s+unidad/.test(n)) return true;
  return false;
}

export function matchCompanySelection(
  text: string,
  contacts: { id: number; empresa: string; nombre: string }[],
): { id: number; empresa: string; nombre: string } | null {
  const raw = text.trim();
  const numMatch =
    raw.match(/^\s*(?:opcion\s*)?(\d{1,3})\s*(?:[).:\-]\s*)?/i) ||
    raw.match(/^\s*(\d{1,3})\s*$/);
  if (numMatch) {
    const idx = Number.parseInt(numMatch[1], 10) - 1;
    if (idx >= 0 && idx < contacts.length) return contacts[idx]!;
  }
  const name = norm(raw.replace(/^\s*(?:opcion\s*)?\d{1,3}\s*[).\-:]?\s*/i, ""));
  if (!name) return null;
  for (const c of contacts) {
    const empresa = norm(c.empresa);
    const nombre = norm(c.nombre);
    if (empresa.includes(name) || name.includes(empresa)) return c;
    if (nombre.includes(name) || name.includes(nombre)) return c;
    if (name.includes("cacique") && empresa.includes("cacique")) return c;
    if (name.includes("wara") && empresa.includes("wara")) return c;
  }
  return null;
}
