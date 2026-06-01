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

export async function obtenerEmpresaPorNumero(rawPhone: string): Promise<WaraEmpresaLookupResult> {
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

async function createWaraSessionToken(): Promise<{
  ok: boolean;
  status: number;
  sessionToken?: string;
  error?: string;
}> {
  const user = process.env.WARA_SESSION_USER?.trim() || "";
  const password = process.env.WARA_SESSION_PASSWORD?.trim() || "";
  const maxIdle = process.env.WARA_SESSION_MAX_IDLE?.trim() || "15m";

  if (!user || !password) {
    return {
      ok: false,
      status: 503,
      error: "WARA_SESSION_USER/WARA_SESSION_PASSWORD no configurados",
    };
  }

  const res = await fetch(`${waraMaintenanceApiBaseUrl()}/CreateSessionToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user, password, maxIdle }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const sessionToken =
    typeof json?.SessionToken === "string"
      ? json.SessionToken
      : typeof json?.sessionToken === "string"
      ? json.sessionToken
      : undefined;

  if (!res.ok || !sessionToken) {
    return {
      ok: false,
      status: res.status,
      error:
        typeof json?.error === "string"
          ? json.error
          : `Wara respondió HTTP ${res.status} al crear sesión`,
    };
  }

  return { ok: true, status: res.status, sessionToken };
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

  // Fallback opcional para endpoints clásicos de mantenimiento si Wara no entrega SessionToken
  // junto con la validación por teléfono.
  const created = await createWaraSessionToken();
  if (!created.ok || !created.sessionToken) {
    return {
      ok: false,
      status: created.status,
      error:
        created.error ||
        "Wara no devolvió SessionToken para este teléfono y no hay credenciales de sesión configuradas",
      lookup: resolution.lookup,
    };
  }

  return {
    ok: true,
    status: 200,
    sessionToken: created.sessionToken,
    customerName: resolution.lookup.customerName,
    companyName: resolution.selectedCompanyName ?? resolution.customer?.companyName?.trim() ?? "",
    contactName: resolution.customer?.name?.trim() || "",
    lookup: resolution.lookup,
  };
}

function errorFromWara(json: Record<string, unknown> | null, fallback: string): string {
  return typeof json?.error === "string" ? json.error : fallback;
}

export async function consultarEstadoUnidades(
  sessionToken: string,
  unidad: number[] = []
): Promise<WaraConsultarEstadoUnidadesResult> {
  const res = await fetch(`${waraMaintenanceApiBaseUrl()}/ConsultarEstadoUnidades`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ token: sessionToken, unidad }),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      unidades: [],
      error: errorFromWara(json, `Wara respondió HTTP ${res.status}`),
    };
  }

  return {
    ok: json?.ok !== false,
    status: res.status,
    cliente: typeof json?.cliente === "string" ? json.cliente : undefined,
    unidades: Array.isArray(json?.unidades) ? (json.unidades as WaraUnidadEstado[]) : [],
    error: json?.ok === false ? errorFromWara(json, "Wara no devolvió unidades") : undefined,
  };
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

  return {
    ok: json?.ok !== false,
    status: res.status,
    movil_id: typeof json?.movil_id === "number" ? json.movil_id : undefined,
    odometro:
      json?.odometro && typeof json.odometro === "object"
        ? (json.odometro as WaraRegistrarCambioResult["odometro"])
        : undefined,
    horometro:
      json?.horometro && typeof json.horometro === "object"
        ? (json.horometro as WaraRegistrarCambioResult["horometro"])
        : undefined,
    error: json?.ok === false ? errorFromWara(json, "Wara no registró el cambio") : undefined,
  };
}

export async function resolveCustomerByWaraPhone(
  prisma: PrismaClient,
  rawPhone: string,
  opts?: { contactName?: string }
): Promise<WaraCustomerResolution> {
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

  if (!lookup.ok || !lookup.encontrado || lookup.contactos.length === 0) {
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
  matchedContact?: WaraEmpresaContact;
  contacts?: WaraEmpresaContact[];
}> {
  const normalized = normalizeWhatsAppPhone(rawPhone);
  if (normalized.length < 8) {
    return { ok: false, customer: null, status: 400, error: "Teléfono inválido" };
  }

  const wantedName = selection.companyName?.trim() || "";
  const wantedIndex =
    wantedName && /^\d+$/.test(wantedName)
      ? Number.parseInt(wantedName, 10) - 1
      : null;
  const wantedId =
    typeof selection.waraContactId === "number" && Number.isFinite(selection.waraContactId)
      ? selection.waraContactId
      : null;

  if (!wantedName && wantedId == null) {
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

  const matched = lookup.contactos.find((c) => {
    if (wantedId != null && c.id === wantedId) return true;
    if (wantedIndex != null && lookup.contactos[wantedIndex]?.id === c.id) return true;
    if (wantedName) {
      const compare = (value: string) =>
        value.localeCompare(wantedName, "es", { sensitivity: "accent" }) === 0;
      if (compare(c.empresa)) return true;
      if (compare(c.nombre)) return true;
    }
    return false;
  });

  if (!matched) {
    return {
      ok: false,
      customer: null,
      status: 409,
      error: "La empresa indicada no figura entre las asociadas a este teléfono",
      contacts: lookup.contactos,
    };
  }

  const local = await findCustomerByWhatsAppNumber(prisma, rawPhone);
  const matchedCompany = matched.empresa || matched.nombre;
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
