import type { Customer, PrismaClient } from "@prisma/client";
import { findCustomerByWhatsAppNumber, normalizeWhatsAppPhone } from "@/lib/whatsappPhone";

export type WaraEmpresaContact = {
  id: number;
  /** Nombre del contacto (persona). */
  nombre: string;
  /** Razón social / empresa asociada al contacto. */
  empresa: string;
};

export type WaraEmpresaLookupResult = {
  configured: boolean;
  ok: boolean;
  encontrado: boolean;
  contactos: WaraEmpresaContact[];
  /**
   * SessionToken devuelto por Wara cuando hay un único contacto activo.
   * Sirve para encadenar otras llamadas de Wara sin volver a pedir token.
   */
  sessionToken?: string;
  customerId?: number;
  customerName?: string;
  userTimezone?: string;
  customerTimezone?: string;
  status?: number;
  error?: string;
};

export type WaraCustomerResolution = {
  customer: Customer | null;
  registered: boolean;
  source: "wara" | "local_fallback" | "none" | "test_blocked";
  lookup: WaraEmpresaLookupResult | null;
  /**
   * Cuando Wara devuelve más de un contacto y aún no se persistió la empresa elegida,
   * el flow de BuilderBot debe pedirle al cliente que confirme cuál.
   */
  requiresCompanySelection: boolean;
  selectedCompanyName: string | null;
  /**
   * True cuando el número fue bloqueado por estar fuera de WARA_TEST_ALLOWED_PHONES.
   * Útil para que BuilderBot no le conteste a quien no es uno de los números de prueba.
   */
  testBlocked?: boolean;
};

/**
 * Lista blanca opcional de teléfonos para pruebas. Si está seteada, SOLO esos números
 * son tratados como "registrados" y disparan el flujo del bot; al resto se les responde
 * como no validados (modo silencio para clientes reales mientras testeamos).
 *
 * Formato de la env: lista separada por comas. Aceptamos cualquier formato (con/sin "+",
 * con/sin "9", con/sin código país); se normaliza igual que `normalizeWhatsAppPhone`.
 *   WARA_TEST_ALLOWED_PHONES="+5492613867127, 5492612478856"
 * Vacío o no seteado => modo abierto (producción real).
 */
function testPhoneWhitelist(): Set<string> {
  const raw = process.env.WARA_TEST_ALLOWED_PHONES?.trim() || "";
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,;\s]+/)
      .map((s) => normalizeWhatsAppPhone(s))
      .filter((s) => s.length >= 8)
  );
}

export function isTestWhitelistEnabled(): boolean {
  return testPhoneWhitelist().size > 0;
}

/** Respuesta corta que parece elegir empresa del menú (1/2, WARA, El Cacique, etc.). */
export function looksLikeCompanySelection(text: string | undefined | null): boolean {
  const t = (text ?? "").trim();
  if (!t || t.length > 60) return false;
  const norm = t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (
    /^(inicio|volver|hola|buenas|menu|ayuda|si|no|confirmo|gracias|buenos dias|buenas tardes|buenas noches)$/.test(
      norm
    )
  ) {
    return false;
  }
  if (/^\d{1,2}$/.test(norm)) return true;
  if (/\bwara\b|\bguara\b|\bcacique\b|\bel cacique\b/.test(norm)) return true;
  if (/^opcion\s*\d{1,2}$/i.test(t)) return true;
  // Nombre de empresa suelto (ej. "WARA", "El Cacique S.A.")
  if (/^[a-z0-9][a-z0-9 .\-]{1,40}$/i.test(t) && !/\b(certificado|patente|reporte|odometro|horometro)\b/.test(norm)) {
    return true;
  }
  return false;
}

function normCompanyToken(value: string): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Alias frecuentes y typos al elegir empresa por chat. */
function expandCompanyAliases(wanted: string): string[] {
  const n = normCompanyToken(wanted);
  const aliases: Record<string, string[]> = {
    guara: ["wara"],
    wara: ["wara"],
    cacique: ["el cacique", "cacique"],
    "el cacique": ["el cacique", "cacique"],
  };
  const base = aliases[n] ?? [n];
  return Array.from(new Set([n, ...base]));
}

function contactMatchesSelection(
  contact: WaraEmpresaContact,
  wantedNameNorm: string
): boolean {
  if (!wantedNameNorm) return false;
  const empresa = normCompanyToken(contact.empresa);
  const nombre = normCompanyToken(contact.nombre);
  const wantedVariants = expandCompanyAliases(wantedNameNorm);

  for (const wanted of wantedVariants) {
    if (!wanted) continue;
    if (empresa === wanted || nombre === wanted) return true;
    if (empresa && (empresa.includes(wanted) || wanted.includes(empresa))) return true;
    if (nombre && (nombre.includes(wanted) || wanted.includes(nombre))) return true;
    const empresaFirst = empresa.split(/\s+/)[0];
    const wantedFirst = wanted.split(/\s+/)[0];
    if (empresaFirst && wantedFirst && empresaFirst === wantedFirst) return true;
    if (empresa.startsWith(wanted) || wanted.startsWith(empresaFirst)) return true;
  }
  return false;
}

export function isPhoneAllowedForTesting(rawPhone: string): boolean {
  const list = testPhoneWhitelist();
  if (list.size === 0) return true;
  const n = normalizeWhatsAppPhone(rawPhone);
  if (!n) return false;
  if (list.has(n)) return true;
  // Tolerancia: comparar también con/sin el "9" después del código de país argentino.
  if (n.startsWith("549")) {
    const without9 = "54" + n.slice(3);
    if (list.has(without9)) return true;
  } else if (n.startsWith("54") && !n.startsWith("549")) {
    const with9 = "549" + n.slice(2);
    if (list.has(with9)) return true;
  }
  return false;
}

/**
 * Mapa opcional de impersonación para pruebas internas.
 * Sintaxis: <miNumero>=<numeroDePrueba>,<otroMiNumero>=<otroDePrueba>
 * Cuando llega un mensaje desde "miNumero", el sistema lo procesa como si fuera "numeroDePrueba"
 * (validación Wara, whitelist, ticket). WhatsApp sigue respondiéndole al número real.
 * Pensado para que un dev pueda escribir desde su WhatsApp personal y probar el flujo del cliente.
 */
function impersonationMap(): Map<string, string> {
  const raw = process.env.WARA_TEST_IMPERSONATE_MAP?.trim() || "";
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const entry of raw.split(/[,;\n]+/)) {
    const [from, to] = entry.split("=").map((s) => s?.trim() ?? "");
    const fromN = normalizeWhatsAppPhone(from);
    const toN = normalizeWhatsAppPhone(to);
    if (fromN.length >= 8 && toN.length >= 8) map.set(fromN, toN);
  }
  return map;
}

export function getImpersonatedPhone(rawPhone: string): {
  effective: string;
  original: string;
  impersonated: boolean;
} {
  const original = normalizeWhatsAppPhone(rawPhone);
  const map = impersonationMap();
  if (map.size === 0 || !original) {
    return { effective: original, original, impersonated: false };
  }
  if (map.has(original)) {
    return { effective: map.get(original)!, original, impersonated: true };
  }
  if (original.startsWith("549")) {
    const without9 = "54" + original.slice(3);
    if (map.has(without9)) return { effective: map.get(without9)!, original, impersonated: true };
  } else if (original.startsWith("54")) {
    const with9 = "549" + original.slice(2);
    if (map.has(with9)) return { effective: map.get(with9)!, original, impersonated: true };
  }
  return { effective: original, original, impersonated: false };
}

function waraApiBaseUrl(): string {
  const raw =
    process.env.WARA_API_BASE_URL?.trim() ||
    "https://apps.visionblo.com/rb/app/api_interna";
  return raw.replace(/\/+$/, "");
}

function waraMaintenanceApiBaseUrl(): string {
  const raw =
    process.env.WARA_MAINTENANCE_API_BASE_URL?.trim() ||
    process.env.WARA_API_BASE_URL?.trim() ||
    "https://apps.visionblo.com/rb/app/api_interna";
  return raw.replace(/\/+$/, "");
}

function obtenerEmpresaToken(): string {
  return process.env.WARA_OBTENER_EMPRESA_TOKEN?.trim() || "";
}

export function isWaraEmpresaLookupConfigured(): boolean {
  return obtenerEmpresaToken().length > 0;
}

export type WaraSessionResolution = {
  ok: boolean;
  status: number;
  sessionToken?: string;
  customerName?: string;
  companyName?: string;
  contactName?: string;
  requiresCompanySelection?: boolean;
  testBlocked?: boolean;
  error?: string;
  lookup?: WaraEmpresaLookupResult | null;
};

export type WaraUnidadEstado = {
  movil_id: number;
  unidad: string;
  patente: string;
  ultimo_reporte?: {
    fecha?: string;
    hace_segundos?: number;
  } | null;
  ultima_posicion?: {
    lat?: number;
    lon?: number;
    fecha?: string;
    hace_segundos?: number;
  } | null;
  ultima_ignicion?: {
    estado?: boolean;
    fecha?: string;
    hace_segundos?: number;
  } | null;
  alimentacion_externa?: {
    voltaje?: number | null;
    fecha?: string;
    hace_segundos?: number;
  } | null;
};

export type WaraConsultarEstadoUnidadesResult = {
  ok: boolean;
  status: number;
  cliente?: string;
  unidades: WaraUnidadEstado[];
  error?: string;
};

export type WaraRegistrarCambioResult = {
  ok: boolean;
  status: number;
  movil_id?: number;
  odometro?: {
    valor_anterior_km?: number;
    valor_nuevo_km?: number;
    correccion_km?: number;
  };
  horometro?: {
    valor_anterior_horas?: number;
    valor_nuevo_horas?: number;
    correccion_horas?: number;
  };
  error?: string;
};

export type WaraCertificadoCoberturaResult = {
  ok: boolean;
  status: number;
  url?: string;
  downloadUrl?: string;
  certificado?: string;
  filename?: string;
  message?: string;
  raw?: Record<string, unknown>;
  error?: string;
};

function normalizeContact(raw: unknown): WaraEmpresaContact | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const idRaw = record.contacto_id ?? record.contactoId ?? record.id;
  const id = Number(idRaw);
  const nombre = typeof record.nombre === "string" ? record.nombre.trim() : "";
  const empresa =
    typeof record.empresa === "string"
      ? record.empresa.trim()
      : typeof record.razonSocial === "string"
      ? (record.razonSocial as string).trim()
      : "";
  if (!Number.isFinite(id)) return null;
  if (!empresa && !nombre) return null;
  return { id, nombre, empresa: empresa || nombre };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wara (sobre todo staging) es intermitente: para el MISMO número, una llamada puede
 * devolver un `200` vacío (`encontrado:false`, 0 contactos) o un 5xx, y la siguiente
 * devolver los contactos reales. Esa intermitencia es la causa de los mensajes
 * "No encontré empresas asociadas" / "No pude consultar las unidades" que ve el cliente.
 *
 * Este wrapper reintenta unas pocas veces ante respuestas no útiles (error de red/HTTP
 * o 200 vacío) con un backoff corto, antes de darse por vencido. No reintenta cuando el
 * error es de pre-vuelo (token no configurado o teléfono inválido), porque ahí no hay nada
 * que reintentar.
 */
export async function obtenerEmpresaPorNumero(rawPhone: string): Promise<WaraEmpresaLookupResult> {
  const maxAttempts = 3;
  const backoffMs = [300, 800];
  let last: WaraEmpresaLookupResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let result: WaraEmpresaLookupResult;
    try {
      result = await obtenerEmpresaPorNumeroOnce(rawPhone);
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      const message = error instanceof Error ? error.message : "error desconocido";
      console.warn(
        `[WaraAPI] ObtenerContactosPorNumero intento ${attempt}/${maxAttempts} lanzó excepción (${message}); reintento`
      );
      await sleep(backoffMs[attempt - 1] ?? 800);
      continue;
    }

    last = result;

    // Caso bueno: Wara respondió con contactos. Listo.
    if (result.ok && result.encontrado && result.contactos.length > 0) return result;

    // Fallos de pre-vuelo (no configurado o teléfono inválido): no hay nada que reintentar.
    // Estos casos retornan sin `status` porque ni siquiera llegan a la red.
    if (!result.configured || (result.status === undefined && !result.ok)) return result;

    // Resto = intermitencia de staging (5xx/red o 200 vacío). Reintentamos si quedan intentos.
    if (attempt < maxAttempts) {
      console.warn(
        `[WaraAPI] ObtenerContactosPorNumero intento ${attempt}/${maxAttempts} sin datos útiles ` +
          `(ok=${result.ok}, encontrado=${result.encontrado}, contactos=${result.contactos.length}, status=${result.status ?? "-"}); reintento`
      );
      await sleep(backoffMs[attempt - 1] ?? 800);
    }
  }

  return last as WaraEmpresaLookupResult;
}

async function obtenerEmpresaPorNumeroOnce(rawPhone: string): Promise<WaraEmpresaLookupResult> {
  const token = obtenerEmpresaToken();
  const telefono = normalizeWhatsAppPhone(rawPhone);
  if (!token) {
    return {
      configured: false,
      ok: false,
      encontrado: false,
      contactos: [],
      error: "WARA_OBTENER_EMPRESA_TOKEN no configurado",
    };
  }
  if (telefono.length < 8) {
    return {
      configured: true,
      ok: false,
      encontrado: false,
      contactos: [],
      error: "Formato de teléfono inválido",
    };
  }

  const res = await fetch(`${waraApiBaseUrl()}/ObtenerContactosPorNumero`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token, telefono }),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    return {
      configured: true,
      ok: false,
      encontrado: false,
      contactos: [],
      status: res.status,
      error:
        typeof json?.error === "string"
          ? json.error
          : `Wara respondió HTTP ${res.status}`,
    };
  }

  // El endpoint puede devolver:
  //   - `contacto` (objeto único) cuando hay un solo contacto activo, junto con
  //     `SessionToken`, `CustomerID`, `CustomerName`, etc.
  //   - `contactos` (array) cuando hay múltiples coincidencias.
  const contactosRaw: unknown[] = Array.isArray(json?.contactos)
    ? (json!.contactos as unknown[])
    : json?.contacto && typeof json.contacto === "object"
    ? [json.contacto]
    : [];

  const contactos = contactosRaw
    .map(normalizeContact)
    .filter((c): c is WaraEmpresaContact => c != null);
  const encontrado = json?.encontrado === true || contactos.length > 0;

  const sessionToken =
    typeof json?.SessionToken === "string"
      ? (json.SessionToken as string)
      : typeof json?.sessionToken === "string"
      ? (json.sessionToken as string)
      : undefined;

  const customerId =
    typeof json?.CustomerID === "number"
      ? (json.CustomerID as number)
      : typeof json?.customerId === "number"
      ? (json.customerId as number)
      : undefined;

  const customerName =
    typeof json?.CustomerName === "string"
      ? (json.CustomerName as string)
      : typeof json?.customerName === "string"
      ? (json.customerName as string)
      : undefined;

  return {
    configured: true,
    ok: json?.ok !== false,
    encontrado,
    contactos,
    sessionToken,
    customerId,
    customerName,
    userTimezone:
      typeof json?.UserTimezone === "string" ? (json.UserTimezone as string) : undefined,
    customerTimezone:
      typeof json?.CustomerTimezone === "string"
        ? (json.CustomerTimezone as string)
        : undefined,
    status: res.status,
  };
}

async function createChatBotToken(contactId: number): Promise<{
  ok: boolean;
  status: number;
  sessionToken?: string;
  customerId?: number;
  customerName?: string;
  userTimezone?: string;
  customerTimezone?: string;
  error?: string;
}> {
  const token = obtenerEmpresaToken();
  if (!token) {
    return {
      ok: false,
      status: 503,
      error: "WARA_OBTENER_EMPRESA_TOKEN no configurado",
    };
  }

  // CreateChatBotToken es intermitente del lado de Wara. Reintentamos una vez
  // ante fallo transitorio (red, 5xx o token vacío) antes de derivar a un agente.
  const maxAttempts = 2;
  let lastError = `Wara no devolvió SessionToken (contacto ${contactId})`;
  let lastStatus = 503;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    let json: Record<string, unknown> | null = null;
    try {
      res = await fetch(`${waraApiBaseUrl()}/CreateChatBotToken`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, contacto_id: contactId }),
        cache: "no-store",
      });
      json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Error de red llamando a CreateChatBotToken";
      lastStatus = 502;
      console.error(
        `[WaraAPI] CreateChatBotToken intento ${attempt}/${maxAttempts} falló (red) contacto=${contactId}: ${lastError}`
      );
      continue;
    }

    const data = waraData(json);
    const pickString = (key: string): string | undefined => {
      if (typeof json?.[key] === "string") return json[key] as string;
      if (typeof data[key] === "string") return data[key] as string;
      return undefined;
    };
    const pickNumber = (key: string): number | undefined => {
      if (typeof json?.[key] === "number") return json[key] as number;
      if (typeof data[key] === "number") return data[key] as number;
      return undefined;
    };
    const sessionToken = pickString("SessionToken") ?? pickString("sessionToken");

    if (res.ok && sessionToken) {
      return {
        ok: true,
        status: res.status,
        sessionToken,
        customerId: pickNumber("CustomerID"),
        customerName: pickString("CustomerName"),
        userTimezone: pickString("UserTimezone"),
        customerTimezone: pickString("CustomerTimezone"),
      };
    }

    lastStatus = res.status;
    lastError =
      typeof json?.error === "string"
        ? json.error
        : `Wara respondió HTTP ${res.status} al crear sesión del chatbot`;
    console.error(
      `[WaraAPI] CreateChatBotToken intento ${attempt}/${maxAttempts} sin token contacto=${contactId} status=${res.status}: ${lastError}`
    );
  }

  return { ok: false, status: lastStatus, error: lastError };
}

function findContactForCompany(
  contacts: WaraEmpresaContact[],
  companyName: string | null | undefined,
  contactId?: number | null
): WaraEmpresaContact | null {
  if (contacts.length === 1) return contacts[0];
  if (contactId != null && Number.isFinite(contactId)) {
    const byId = contacts.find((c) => c.id === contactId);
    if (byId) return byId;
  }
  const selected = companyName?.trim();
  if (!selected) return null;
  return (
    contacts.find(
      (c) =>
        c.empresa.localeCompare(selected, "es", { sensitivity: "accent" }) === 0 ||
        c.nombre.localeCompare(selected, "es", { sensitivity: "accent" }) === 0
    ) ?? null
  );
}

/** Verifica que Wara pueda crear SessionToken para un contacto (multi-empresa). */
export async function probeWaraContactSession(contactId: number): Promise<{
  ok: boolean;
  status: number;
  error?: string;
}> {
  const created = await createChatBotToken(contactId);
  return { ok: created.ok, status: created.status, error: created.error };
}

export async function resolveWaraSessionByPhone(
  prisma: PrismaClient,
  rawPhone: string
): Promise<WaraSessionResolution> {
  const resolution = await resolveCustomerByWaraPhone(prisma, rawPhone);
  if (resolution.testBlocked) {
    return {
      ok: false,
      status: 403,
      error: "Número fuera de la lista de prueba",
      testBlocked: true,
      lookup: resolution.lookup,
    };
  }
  if (!resolution.registered || !resolution.lookup?.ok) {
    return {
      ok: false,
      status: resolution.lookup?.status ?? 404,
      error: resolution.lookup?.error || "Wara no reconoce este teléfono",
      lookup: resolution.lookup,
    };
  }
  if (resolution.requiresCompanySelection) {
    return {
      ok: false,
      status: 409,
      error: "El teléfono tiene varias empresas asociadas; primero debe elegir empresa",
      requiresCompanySelection: true,
      lookup: resolution.lookup,
    };
  }

  if (resolution.lookup.sessionToken) {
    return {
      ok: true,
      status: 200,
      sessionToken: resolution.lookup.sessionToken,
      customerName: resolution.lookup.customerName,
      companyName: resolution.selectedCompanyName ?? resolution.customer?.companyName?.trim() ?? "",
      contactName: resolution.customer?.name?.trim() || "",
      lookup: resolution.lookup,
    };
  }

  // Si hay múltiples contactos, la documentación nueva indica que hay que crear
  // el SessionToken con token ATILIO + contacto_id seleccionado.
  const selectedContact = findContactForCompany(
    resolution.lookup.contactos,
    resolution.selectedCompanyName ?? resolution.customer?.companyName
  );
  if (!selectedContact) {
    return {
      ok: false,
      status: 409,
      error: "No pude determinar el contacto de Wara para crear el SessionToken",
      requiresCompanySelection: true,
      lookup: resolution.lookup,
    };
  }

  const created = await createChatBotToken(selectedContact.id);
  if (!created.ok || !created.sessionToken) {
    const companyLabel =
      resolution.selectedCompanyName ?? selectedContact.empresa ?? "";
    const errLower = (created.error ?? "").toLowerCase();
    const userHint =
      errLower.includes("inexistente") || errLower.includes("no autorizado")
        ? `Wara no habilitó el acceso al chatbot para ${companyLabel || "esa empresa"}. Probá con otra empresa o escribí "cambiar empresa".`
        : created.error ||
          "Wara no devolvió SessionToken para el contacto seleccionado";
    console.error(
      `[WaraAPI] No se pudo crear sesión Wara para empresa="${companyLabel}" contacto=${selectedContact.id}: ${created.error ?? "sin detalle"}`
    );
    return {
      ok: false,
      status: created.status,
      error: userHint,
      lookup: resolution.lookup,
    };
  }

  return {
    ok: true,
    status: 200,
    sessionToken: created.sessionToken,
    customerName: created.customerName ?? resolution.lookup.customerName,
    companyName:
      created.customerName ??
      resolution.selectedCompanyName ??
      resolution.customer?.companyName?.trim() ??
      selectedContact.empresa ??
      "",
    contactName: resolution.customer?.name?.trim() || selectedContact.nombre || "",
    lookup: {
      ...resolution.lookup,
      sessionToken: created.sessionToken,
      customerId: created.customerId ?? resolution.lookup.customerId,
      customerName: created.customerName ?? resolution.lookup.customerName,
      userTimezone: created.userTimezone ?? resolution.lookup.userTimezone,
      customerTimezone: created.customerTimezone ?? resolution.lookup.customerTimezone,
    },
  };
}

function errorFromWara(json: Record<string, unknown> | null, fallback: string): string {
  return typeof json?.error === "string" ? json.error : fallback;
}

/**
 * Wara envuelve el contenido útil en `data` (p. ej. ConsultarEstadoUnidades responde
 * { ok: true, data: { cliente, unidades: [...] } }). Esta función devuelve el objeto
 * `data` si existe, o el propio json como fallback para compatibilidad.
 */
function waraData(json: Record<string, unknown> | null): Record<string, unknown> {
  if (json && typeof json.data === "object" && json.data !== null) {
    return json.data as Record<string, unknown>;
  }
  return json ?? {};
}

export async function consultarEstadoUnidades(
  sessionToken: string,
  patentes: string[] = []
): Promise<WaraConsultarEstadoUnidadesResult> {
  // Igual que el lookup de empresa, ConsultarEstadoUnidades es intermitente en staging.
  // Reintentamos ante error de red/HTTP antes de derivar a un agente.
  const maxAttempts = 3;
  const backoffMs = [300, 800];
  let last: WaraConsultarEstadoUnidadesResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${waraMaintenanceApiBaseUrl()}/ConsultarEstadoUnidades`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ token: sessionToken, patentes }),
        cache: "no-store",
      });
    } catch (error) {
      last = {
        ok: false,
        status: 502,
        unidades: [],
        error: error instanceof Error ? error.message : "Error de red llamando a Wara",
      };
      if (attempt < maxAttempts) {
        console.warn(
          `[WaraAPI] ConsultarEstadoUnidades intento ${attempt}/${maxAttempts} falló (red); reintento`
        );
        await sleep(backoffMs[attempt - 1] ?? 800);
        continue;
      }
      return last;
    }

    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      last = {
        ok: false,
        status: res.status,
        unidades: [],
        error: errorFromWara(json, `Wara respondió HTTP ${res.status}`),
      };
      // 5xx = transitorio, reintentamos; 4xx = problema real, no reintentamos.
      if (res.status >= 500 && attempt < maxAttempts) {
        console.warn(
          `[WaraAPI] ConsultarEstadoUnidades intento ${attempt}/${maxAttempts} HTTP ${res.status}; reintento`
        );
        await sleep(backoffMs[attempt - 1] ?? 800);
        continue;
      }
      return last;
    }

    const data = waraData(json);
    return {
      ok: json?.ok !== false,
      status: res.status,
      cliente: typeof data.cliente === "string" ? data.cliente : undefined,
      unidades: Array.isArray(data.unidades) ? (data.unidades as WaraUnidadEstado[]) : [],
      error: json?.ok === false ? errorFromWara(json, "Wara no devolvió unidades") : undefined,
    };
  }

  return (
    last ?? {
      ok: false,
      status: 502,
      unidades: [],
      error: "No se pudo consultar el estado de unidades en Wara",
    }
  );
}

export async function registrarCambioOdometroHorometro(
  sessionToken: string,
  payload: {
    patente: string;
    fecha: string;
    odometro?: number;
    horometro?: number;
  }
): Promise<WaraRegistrarCambioResult> {
  const body: Record<string, unknown> = {
    token: sessionToken,
    patente: payload.patente,
    fecha: payload.fecha,
  };
  if (typeof payload.odometro === "number") body.odometro = payload.odometro;
  if (typeof payload.horometro === "number") body.horometro = payload.horometro;

  const res = await fetch(`${waraMaintenanceApiBaseUrl()}/RegistrarCambioOdometroHorometro`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: errorFromWara(json, `Wara respondió HTTP ${res.status}`),
    };
  }

  const data = waraData(json);
  return {
    ok: json?.ok !== false,
    status: res.status,
    movil_id: typeof data.movil_id === "number" ? data.movil_id : undefined,
    odometro:
      data.odometro && typeof data.odometro === "object"
        ? (data.odometro as WaraRegistrarCambioResult["odometro"])
        : undefined,
    horometro:
      data.horometro && typeof data.horometro === "object"
        ? (data.horometro as WaraRegistrarCambioResult["horometro"])
        : undefined,
    error: json?.ok === false ? errorFromWara(json, "Wara no registró el cambio") : undefined,
  };
}

function firstString(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export async function obtenerCertificadoCobertura(
  sessionToken: string,
  patente: string
): Promise<WaraCertificadoCoberturaResult> {
  const res = await fetch(`${waraMaintenanceApiBaseUrl()}/Certificadocobertura`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ token: sessionToken, patente }),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: errorFromWara(json, `Wara respondió HTTP ${res.status}`),
      raw: json ?? undefined,
    };
  }

  const data = waraData(json);
  const url = firstString(data, ["url", "URL", "link", "Link", "certificado_url", "certificadoUrl", "archivo_url"]);
  const certificado = firstString(data, ["certificado", "pdf", "base64", "archivo", "file", "documento"]);
  const message = firstString(data, ["message", "mensaje", "detalle"]);

  return {
    ok: json?.ok !== false,
    status: res.status,
    url,
    downloadUrl: firstString(data, ["downloadUrl", "download_url", "url_descarga"]),
    certificado,
    filename: firstString(data, ["filename", "fileName", "nombre_archivo"]),
    message,
    raw: data,
    error: json?.ok === false ? errorFromWara(json, "Wara no generó el certificado") : undefined,
  };
}

export async function resolveCustomerByWaraPhone(
  prisma: PrismaClient,
  rawPhone: string,
  opts?: { contactName?: string }
): Promise<WaraCustomerResolution> {
  const impersonation = getImpersonatedPhone(rawPhone);
  if (impersonation.impersonated) {
    console.log(
      `[WaraAPI] Impersonación de prueba: ${impersonation.original} -> ${impersonation.effective}`
    );
    rawPhone = impersonation.effective;
  }
  const normalized = normalizeWhatsAppPhone(rawPhone);
  if (normalized.length < 8) {
    return {
      customer: null,
      registered: false,
      source: "none",
      lookup: null,
      requiresCompanySelection: false,
      selectedCompanyName: null,
    };
  }

  // Modo whitelist (pruebas internas): si está activado y el número no está en la lista,
  // tratamos al cliente como no validado para que el bot no le conteste.
  if (isTestWhitelistEnabled() && !isPhoneAllowedForTesting(rawPhone)) {
    console.log(
      `[WaraAPI] WARA_TEST_ALLOWED_PHONES activo y ${normalized} no está en la lista; bloqueado.`
    );
    return {
      customer: null,
      registered: false,
      source: "test_blocked",
      lookup: null,
      requiresCompanySelection: false,
      selectedCompanyName: null,
      testBlocked: true,
    };
  }

  const local = await findCustomerByWhatsAppNumber(prisma, rawPhone);
  let lookup: WaraEmpresaLookupResult;
  try {
    lookup = await obtenerEmpresaPorNumero(rawPhone);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error consultando Wara";
    console.error("[WaraAPI] ObtenerEmpresaPorNumero falló:", message);
    return {
      customer: local,
      registered: !!local,
      source: local ? "local_fallback" : "none",
      lookup: {
        configured: isWaraEmpresaLookupConfigured(),
        ok: false,
        encontrado: false,
        contactos: [],
        error: message,
      },
      requiresCompanySelection: false,
      selectedCompanyName: local?.companyName?.trim() || null,
    };
  }

  if (!lookup.configured) {
    return {
      customer: local,
      registered: !!local,
      source: local ? "local_fallback" : "none",
      lookup,
      requiresCompanySelection: false,
      selectedCompanyName: local?.companyName?.trim() || null,
    };
  }

  if (!lookup.ok) {
    return {
      customer: local,
      registered: !!local,
      source: local ? "local_fallback" : "wara",
      lookup,
      requiresCompanySelection: false,
      selectedCompanyName: local?.companyName?.trim() || null,
    };
  }

  if (!lookup.encontrado || lookup.contactos.length === 0) {
    return {
      customer: null,
      registered: false,
      source: "wara",
      lookup,
      requiresCompanySelection: false,
      selectedCompanyName: null,
    };
  }

  // Si hay UNA sola empresa, la fijamos directo. Si hay varias y el cliente ya eligió
  // antes (companyName local sigue en la lista de Wara), se respeta esa elección.
  // Si hay varias y nada elegido aún, dejamos companyName en blanco hasta que confirme.
  const previouslySelected = local?.companyName?.trim() || null;
  let chosenCompany: string | null = null;

  if (lookup.contactos.length === 1) {
    chosenCompany = lookup.contactos[0].empresa || lookup.contactos[0].nombre;
  } else if (
    previouslySelected &&
    lookup.contactos.some(
      (c) =>
        c.empresa.localeCompare(previouslySelected, "es", { sensitivity: "accent" }) === 0
    )
  ) {
    chosenCompany = previouslySelected;
  }

  // Wara puede devolver el nombre del contacto (persona); lo guardamos como name del Customer
  // si todavía no tenemos uno.
  const waraContactName =
    lookup.contactos.length === 1 ? lookup.contactos[0].nombre.trim() : "";

  const data: { phone: string; name?: string; companyName?: string } = {
    phone: normalized,
  };
  const newName = opts?.contactName?.trim() || waraContactName || "";
  if (newName && (!local?.name || local.name.trim() !== newName)) {
    data.name = newName;
  }
  if (chosenCompany) {
    data.companyName = chosenCompany;
  }

  const customer = local
    ? await prisma.customer.update({ where: { id: local.id }, data })
    : await prisma.customer.create({ data });

  const requiresCompanySelection = lookup.contactos.length > 1 && !chosenCompany;
  if (requiresCompanySelection) {
    console.log(
      `[WaraAPI] ${normalized} tiene ${lookup.contactos.length} contactos en Wara; falta confirmar cuál.`
    );
  }

  return {
    customer,
    registered: true,
    source: "wara",
    lookup,
    requiresCompanySelection,
    selectedCompanyName: chosenCompany,
  };
}

/**
 * Persiste la empresa elegida por el cliente cuando Wara había devuelto múltiples contactos.
 * Verifica contra Wara que el nombre/id corresponda a este teléfono antes de guardarlo.
 */
export async function selectCompanyForCustomer(
  prisma: PrismaClient,
  rawPhone: string,
  selection: { companyName?: string; waraContactId?: number }
): Promise<{
  ok: boolean;
  customer: Customer | null;
  status: number;
  error?: string;
  menuMessage?: string;
  matchedContact?: WaraEmpresaContact;
  contacts?: WaraEmpresaContact[];
}> {
  const impersonation = getImpersonatedPhone(rawPhone);
  if (impersonation.impersonated) {
    rawPhone = impersonation.effective;
  }
  const normalized = normalizeWhatsAppPhone(rawPhone);
  if (normalized.length < 8) {
    return { ok: false, customer: null, status: 400, error: "Teléfono inválido" };
  }

  const wantedRaw = selection.companyName?.trim() || "";
  // El cliente puede responder de varias formas: "1", "wara", "1 wara",
  // "1. WARA", "opcion 2", "el cacique". Extraemos por separado el número
  // de opción inicial (si lo hay) y la parte de texto del nombre.
  const leadingNumberMatch = wantedRaw.match(/^\s*(?:opci[oó]n\s*)?(\d{1,3})\b/i);
  const wantedIndex = leadingNumberMatch
    ? Number.parseInt(leadingNumberMatch[1], 10) - 1
    : null;
  // Nombre = el texto sacando el número de opción inicial y separadores.
  const wantedName = wantedRaw
    .replace(/^\s*(?:opci[oó]n\s*)?\d{1,3}\s*[).\-:]?\s*/i, "")
    .trim();
  const wantedId =
    typeof selection.waraContactId === "number" && Number.isFinite(selection.waraContactId)
      ? selection.waraContactId
      : null;

  if (!wantedName && wantedId == null && wantedIndex == null) {
    return {
      ok: false,
      customer: null,
      status: 400,
      error: "Indicá companyName o waraContactId",
    };
  }

  const lookup = await obtenerEmpresaPorNumero(rawPhone);
  if (!lookup.configured) {
    return {
      ok: false,
      customer: null,
      status: 503,
      error: "WARA_OBTENER_EMPRESA_TOKEN no configurado",
    };
  }
  if (!lookup.ok) {
    return {
      ok: false,
      customer: null,
      status: lookup.status ?? 502,
      error: lookup.error || "Wara no respondió correctamente",
    };
  }
  if (!lookup.encontrado || lookup.contactos.length === 0) {
    return {
      ok: false,
      customer: null,
      status: 404,
      error: "Wara no reconoce este teléfono",
      contacts: [],
    };
  }

  // Normaliza para comparar sin acentos, sin mayúsculas y sin espacios extra.
  const wantedNameNorm = normCompanyToken(wantedName);

  const matched =
    // 1) Por id explícito
    (wantedId != null
      ? lookup.contactos.find((c) => c.id === wantedId)
      : undefined) ??
    // 2) Por número de opción (índice del menú)
    (wantedIndex != null && wantedIndex >= 0 && wantedIndex < lookup.contactos.length
      ? lookup.contactos[wantedIndex]
      : undefined) ??
    // 3) Por nombre: exacto, contiene, alias (guara→wara), primera palabra, etc.
    (wantedNameNorm
      ? lookup.contactos.find((c) => contactMatchesSelection(c, wantedNameNorm))
      : undefined);

  if (!matched) {
    const menu = lookup.contactos
      .map((c, i) => `${i + 1}. ${c.empresa || c.nombre}`)
      .join("\n");
    return {
      ok: false,
      customer: null,
      status: 409,
      error: "La empresa indicada no figura entre las asociadas a este teléfono",
      contacts: lookup.contactos,
      menuMessage: menu
        ? `No reconocí esa opción. ¿De cuál empresa escribís?\n\n${menu}\n\nRespondé con el número de la opción o con el nombre de la empresa.`
        : undefined,
    };
  }

  const matchedCompany = matched.empresa || matched.nombre;

  if (lookup.contactos.length > 1) {
    const sessionProbe = await probeWaraContactSession(matched.id);
    if (!sessionProbe.ok) {
      const errLower = (sessionProbe.error ?? "").toLowerCase();
      const menu = lookup.contactos
        .map((c, i) => `${i + 1}. ${c.empresa || c.nombre}`)
        .join("\n");
      const hint =
        errLower.includes("inexistente") || errLower.includes("no autorizado")
          ? `Wara no habilitó el chatbot para "${matchedCompany}" con este número.`
          : `No pude abrir sesión en Wara para "${matchedCompany}".`;
      return {
        ok: false,
        customer: null,
        status: sessionProbe.status >= 400 ? sessionProbe.status : 502,
        error: sessionProbe.error || hint,
        contacts: lookup.contactos,
        matchedContact: matched,
        menuMessage:
          menu &&
          `${hint} Elegí otra empresa si corresponde:\n\n${menu}\n\nRespondé con el número de la opción o el nombre de la empresa.`,
      };
    }
  }

  const local = await findCustomerByWhatsAppNumber(prisma, rawPhone);
  const customer = local
    ? await prisma.customer.update({
        where: { id: local.id },
        data: { companyName: matchedCompany },
      })
    : await prisma.customer.create({
        data: { phone: normalized, companyName: matchedCompany },
      });

  return {
    ok: true,
    customer,
    status: 200,
    matchedContact: matched,
    contacts: lookup.contactos,
  };
}
