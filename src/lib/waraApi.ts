import type { Customer, PrismaClient } from "@prisma/client";
import {
  isPruebasContactAliasesActive,
  resolvePruebasContactAliases,
} from "@/config/pruebasContactAliases";
import {
  formatPlateWithSpaces,
  hasPendingOdometerConfirmation,
  hasPendingMaintenancePlateRequest,
  isBarePlatePrefixHint,
  isOdometerFlowSuperseded,
  looksLikeOdometerIntentStart,
  normalizePlate,
  threadAwaitingOdometerPlate,
  detectLoosePlate,
  extractPlatePrefixFromMessage,
} from "@/lib/wara";
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

/** Pregunta explícita por las empresas asociadas al número. */
export function looksLikeCompanyListQuestion(text: string | undefined | null): boolean {
  const n = normCompanyToken(text ?? "");
  if (!n) return false;
  if (/\b(que|q|cuales|cuantas)\b.*\bempresa/.test(n)) return true;
  if (/\bempresa/.test(n) && /\b(tengo|asociad|vinculad|lista|figur|estoy|operando|uso|usando)\b/.test(n)) {
    return true;
  }
  return false;
}

/** Frases para cambiar/reiniciar empresa (flujo Cambiar en BuilderBot, no selección del menú). */
/** Corregir la patente/matrícula del trámite en curso — no es cambiar de empresa Wara. */
export function looksLikePlateCorrectionRequest(text: string | undefined | null): boolean {
  const t = (text ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!t) return false;
  if (
    /\b(cambiar|corregir|rectificar|modificar|actualizar)\b.*\b(matr[i]?cula|patente)\b/.test(t)
  ) {
    return true;
  }
  if (/\b(matr[i]?cula|patente)\b.*\b(incorrecta|equivocada|mal|error)\b/.test(t)) {
    return true;
  }
  if (/\bno es la (correcta|patente|matricula)\b/.test(t)) return true;
  if (/\bme equivoque de (patente|matricula)\b/.test(t)) return true;
  if (/\bno\b.{0,16}\bla\b/.test(t) && /[a-z0-9]{3,}/.test(t.replace(/\s+/g, ""))) return true;
  if (/\bno\b.{0,12}\bpara\b.{0,16}\bpatente\b/.test(t)) return true;
  if (/\bno\b.{0,12}\bpara\b.{0,12}\bla\b/.test(t)) return true;
  if (/\b(otra|otro)\b.{0,16}\bpatente\b/.test(t)) return true;
  return false;
}

/** Trámite operativo distinto de odómetro (certificado, reporte, etc.). */
export function looksLikeNonOdometerOperationalIntent(text: string | undefined | null): boolean {
  const n = normCompanyToken(text ?? "");
  if (!n) return false;
  if (looksLikeOdometerIntentStart(text)) return false;
  if (looksLikeOperationalMaintenanceIntent(text ?? "")) return true;
  if (looksLikePlateCorrectionRequest(text)) return true;
  if (/\b(certificado|cobertura|monitoreo|constancia)\b/.test(n)) return true;
  if (/\b(reporte|ultimo reporte|sin reporte|offline|listado|mis unidades)\b/.test(n)) return true;
  if (/\b(mantenimiento|asesor|ticket|reclamo)\b/.test(n) && !/\b(od[oó]metro|hor[oó]metro)\b/.test(n)) {
    return true;
  }
  return false;
}

const VEHICLE_BRAND_TOKENS = new Set([
  "nissan",
  "toyota",
  "ford",
  "chevrolet",
  "chevy",
  "mercedes",
  "volkswagen",
  "vw",
  "renault",
  "peugeot",
  "fiat",
  "iveco",
  "scania",
  "volvo",
  "hyundai",
  "kia",
  "honda",
  "isuzu",
  "citroen",
  "ram",
  "dodge",
  "jeep",
  "mitsubishi",
  "mitsubisi",
  "subaru",
  "suzuki",
  "daf",
  "man",
  "agrale",
  "saveiro",
  "sprinter",
  "accelo",
  "amarok",
  "hilux",
  "ranger",
  "corsa",
  "cruze",
  "onix",
  "etios",
  "corolla",
  "frontier",
  "territory",
]);

/** Marca o nombre corto de unidad — no es cambiar de empresa Wara. */
export function looksLikeVehicleBrandOrUnitSearch(text: string | undefined | null): boolean {
  const t = normCompanyToken(text ?? "");
  if (!t || t.length > 48) return false;
  if (/\b(empresa|wara|cacique|guara)\b/.test(t)) return false;
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 6) return false;
  return tokens.some((token) => VEHICLE_BRAND_TOKENS.has(token));
}

export function looksLikeChangeCompanyRequest(text: string | undefined | null): boolean {
  const t = (text ?? "").trim().toLowerCase();
  if (!t) return false;
  if (looksLikeVehicleBrandOrUnitSearch(text)) return false;
  if (looksLikePlateCorrectionRequest(text)) return false;
  if (
    /\b(pasar a|operar con|usar|trabajar con|seguir con)\b/.test(t) &&
    /\b(wara|guara|cacique)\b/.test(t)
  ) {
    return false;
  }
  if (
    /\b(mantenimiento|patente|matricula|matr[ií]cula|certificado|reporte|odometro|horometro|unidad)\b/.test(
      t.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    )
  ) {
    return false;
  }
  if (/^reiniciar(\s+de)?\s+empresa$/.test(t)) return true;
  if (/\b(cambiar|cambio|cambiá|cambiarme|otra|elegir|seleccionar|reiniciar)\b.*\bempresa\b/.test(t)) {
    return true;
  }
  if (/\bempresa\b.*\b(cambiar|equivocada|otra|reiniciar)\b/.test(t)) return true;
  if (/^cambiar(\s+de)?\s+empresa$/.test(t)) return true;
  // Typos / variantes: "quiero cambiar de empresa", no "cambiar matrícula".
  if (/\b(cambiar|cambiarme)\b/.test(t) && /\bempresa\b/.test(t) && t.split(/\s+/).length <= 6) {
    return true;
  }
  if (/\bquiero\s+cambiar\b/.test(t) && /\bempresa\b/.test(t) && t.split(/\s+/).length <= 7) {
    return true;
  }
  return false;
}

export function looksLikeShortAffirmative(text: string | undefined | null): boolean {
  const t = (text ?? "").trim().toLowerCase();
  return /^(si|sí|dale|ok|okey|okay|bueno|perfecto|listo|confirmo|confirma|de acuerdo|avancemos|siguiente|claro|exacto)$/.test(
    t
  );
}

export function looksLikeOperationalIntent(text: string): boolean {
  const n = normCompanyToken(text);
  if (!n) return false;
  return /\b(quiero|necesito|programar|consultar|solicitar|pedir|ver|dame|decime|pasame|reporte|mantenimiento|certificado|patente|odometro|horometro|unidad|unidades|flota|ticket|reclamo|asesor|ubicacion|ignicion|voltaje|offline|falla|problema|ayuda|como hago|como puedo|estado de|ultimo reporte|sin reporte)\b/.test(
    n
  );
}

/** Respuesta corta que parece elegir empresa del menú (1/2, WARA, El Cacique, etc.). */
export function looksLikeCompanySelection(text: string | undefined | null): boolean {
  if (looksLikeCompanyListQuestion(text)) return false;
  if (looksLikeChangeCompanyRequest(text)) return false;
  if (looksLikeVehicleBrandOrUnitSearch(text)) return false;
  const t = (text ?? "").trim();
  if (!t || t.length > 50) return false;
  if (looksLikeOperationalIntent(t)) return false;
  const norm = normCompanyToken(t);
  if (
    /^(inicio|volver|hola|buenas|menu|ayuda|si|no|confirmo|gracias|buenos dias|buenas tardes|buenas noches)$/.test(
      norm
    )
  ) {
    return false;
  }
  if (/^\d{1,2}$/.test(norm)) return true;
  if (/^opcion\s*\d{1,2}$/i.test(t)) return true;
  if (/^(wara|guara|el cacique|cacique|el cacique sa|el cacique s\.?a\.?)$/i.test(norm)) return true;
  if (norm.split(/\s+/).length <= 5 && /\b(wara|guara|el cacique|cacique)\b/.test(norm)) {
    return true;
  }
  return false;
}

function looksLikeOdometerConfirmReply(text: string | undefined | null): boolean {
  if (looksLikeConversationAcknowledgement(text)) return false;
  const t = normCompanyToken(text ?? "").replace(/[^a-z]/g, "");
  if (!t) return false;
  if (t.startsWith("conf")) return true;
  if (/\b(gracias|chau|chao|nosvemos|denada)\b/.test(t)) return false;
  return new Set(["si", "dale"]).has(t);
}

/** Agradecimiento o cierre breve — no es confirmación operativa ni continuación de trámite. */
export function looksLikeConversationAcknowledgement(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 140) return false;
  const t = normCompanyToken(raw);
  if (
    /\b(gracias|agradezco|de nada|chau|chao|nos vemos|nada mas|nada mas gracias|listo gracias|ok gracias|perfecto gracias|genial gracias|buenisimo gracias)\b/.test(
      t,
    )
  ) {
    return true;
  }
  return /^(ok|listo|perfecto|genial|buenisimo|buenisima|dale gracias)[\s!.,¡¿]*$/.test(t);
}

/** Mensaje que sigue un trámite de odómetro (confirmación, patente, km, fecha). */
export function looksLikeOdometerContinuationMessage(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  if (looksLikeConversationAcknowledgement(raw)) return false;
  if (looksLikeNonOdometerOperationalIntent(raw)) return false;
  if (looksLikeOdometerConfirmReply(raw)) return true;
  const t = normCompanyToken(raw);
  if (/\b(od[oó]metro|hor[oó]metro|kilometraje|kil[oó]metros)\b/.test(t)) return true;
  if (/\b(fecha|ayer|hoy)\b/.test(t)) return true;
  if (/\b(cambiar|corregir|modificar).{0,24}(patente|matricula)\b/.test(t)) return true;
  if (/^\d{4,7}$/.test(raw.replace(/\./g, "").replace(/\s+/g, ""))) return true;
  const plate = normalizePlate(raw.replace(/[\s\-_.]+/g, ""));
  return !!(plate && /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(plate));
}

/** ¿Seguir en flujo de odómetro o el cliente cambió de tema? */
export function shouldContinueOdometerFlow(text: string, threadText: string): boolean {
  if (looksLikeConversationAcknowledgement(text)) return false;
  if (looksLikeNonOdometerOperationalIntent(text)) return false;
  if (looksLikeOpcionesInfoRequest(text) || looksLikeUnidadesInfoRequest(text)) return false;
  if (looksLikeAtilioHelpRequest(text)) return false;
  if (isOdometerFlowSuperseded(threadText)) return false;
  if (threadAwaitingOdometerPlate(threadText)) {
    return looksLikeOdometerContinuationMessage(text);
  }
  if (hasPendingOdometerConfirmation(threadText)) {
    return looksLikeOdometerContinuationMessage(text);
  }
  const t = normCompanyToken(text);
  return /\b(od[oó]metro|hor[oó]metro|kilometraje|kil[oó]metros)\b/.test(t);
}

/** Guía informativa del módulo Opciones (Agenda, Perfiles, Notificaciones). */
export function looksLikeOpcionesInfoRequest(text: string | undefined | null): boolean {
  const t = normCompanyToken(text ?? "");
  if (!t) return false;
  if (/\b(mantenimiento|preventiv|correctiv|odometro|horometro|certificado)\b/.test(t) && !/\b(agenda|contacto|notific|perfil|opciones)\b/.test(t)) {
    return false;
  }
  if (
    /\b(usuarios?|usuario)\b/.test(t) &&
    /\b(empresa|perfil|perfiles|opciones|ver|listar|mostrar|mi empresa)\b/.test(t)
  ) {
    return true;
  }
  if (
    /\b(configuracion|configurar)\b/.test(t) &&
    /\b(aenda|agenda|contacto|contactos|opciones|perfil|perfiles|usuario|usuarios|notific)\b/.test(t)
  ) {
    return true;
  }
  return /\b(agenda|aenda|contacto|contactos|perfil|perfiles|permiso|permisos|notificacion|notificaciones|alerta|alertas|alarma|alarmas|destino|destinos|evento|eventos|opciones|telegram|chofer|supervisor|administrador|correo|anadir contacto|añadir contacto|agregar contacto|asignar perfil|asignar usuario|geocerca|punto|base|configurar una alarma|configurar alarma)\b/.test(
    t
  ) ||
    (/\b(me ayudas|ayudame|ayudarme|podes ayudar|pod[eé]s ayudar)\b/.test(t) &&
      /\b(agenda|aenda|opciones|contacto|notific|perfil|alarma|configuracion|configurar)\b/.test(t)) ||
    (/\bcomo funciona\b/.test(t) && /\b(agenda|aenda|opciones|contacto|notific|perfil)\b/.test(t));
}

export function looksLikeOpcionesGuideInThread(threadText: string): boolean {
  const tail = normCompanyToken(threadText.slice(-4000));
  if (!tail) return false;
  const opcionesRoute =
    /(opciones|entra a opciones|entrar a opciones|ingresa a opciones)/.test(tail) &&
    /(agenda|notific|perfil|contacto|alarma|alerta)/.test(tail);
  const agendaSteps =
    /(agregar contacto|anadir contacto|agenda)/.test(tail) &&
    /(chofer|supervisor|perfil|grupo|contacto)/.test(tail);
  const numberedGuide =
    /1\.\s*entra/.test(tail) && /agenda/.test(tail) && /guard/.test(tail);
  return opcionesRoute || agendaSteps || numberedGuide;
}

/** Guía informativa del módulo Unidades (panel de flota, MIS ATAJOS). */
export function looksLikeUnidadesInfoRequest(text: string | undefined | null): boolean {
  const t = normCompanyToken(text ?? "");
  if (!t) return false;
  if (
    /\b(no reporta|no actualiza|offline|sin reporte|ultimo reporte|consultar|reporte en vivo|patente|certificado|odometro|horometro|mantenimiento)\b/.test(
      t
    ) &&
    !/\b(modulo unidades|modulo de unidades|mis atajos|chevron|ficha expandida|grupo de unidades|crear grupo|mover unidades|punto rojo|punto verde|punto azul|barra lateral|icono del auto|seguimiento y control)\b/.test(
      t
    )
  ) {
    return false;
  }
  return (
    /\b(modulo unidades|modulo de unidades|mis atajos|chevron|ficha expandida|grupo de unidades|crear grupo|mover unidades|punto rojo|punto verde|punto azul|mostrar ocultar|lista o tarjetas|encabezado del modulo|configurar unidad|compartir posicion|orden de trabajo|flujo del operador|barra lateral|icono del auto|seguimiento y control|ataljos|historial en el modulo)\b/.test(
      t
    ) ||
    (/\b(como|donde|que es|que significa|para que sirve)\b/.test(t) &&
      /\b(unidades|unidad|flota|mapa|grupo|ficha|historial|ataljos|panel)\b/.test(t) &&
      !/\b(reporta|reporte|consultar|patente|certificado|offline)\b/.test(t))
  );
}

export function looksLikeUnidadesGuideInThread(threadText: string): boolean {
  const tail = normCompanyToken(threadText.slice(-4000));
  if (!tail) return false;
  const moduleRoute =
    /(modulo unidades|modulo de unidades|barra lateral|icono del auto)/.test(tail) &&
    /(grupo|ficha|mapa|flota|ataljos|chevron)/.test(tail);
  const atajosGuide =
    /mis atajos/.test(tail) && /(historial|compartir|configurar unidad|orden de trabajo)/.test(tail);
  const colorDots =
    /punto (rojo|verde|azul)/.test(tail) && /(unidad|alarma|activa|detenida)/.test(tail);
  const numberedGuide =
    /1\.\s*(entra|ingresa|abri)/.test(tail) && /(unidades|modulo unidades|grupo)/.test(tail);
  return moduleRoute || atajosGuide || colorDots || numberedGuide;
}

export function looksLikePlatformInfoGuideInThread(threadText: string): boolean {
  return looksLikeOpcionesGuideInThread(threadText) || looksLikeUnidadesGuideInThread(threadText);
}

function isGenericMaintenanceFallbackText(text: string): boolean {
  return normCompanyToken(text) === "solicitud de gestion de mantenimiento";
}

/** Confirma empresa elegida sin duplicar punto final (p. ej. "S.A." → "S.A.."). */
export function formatCompanyConfirmMessage(companyName: string): string {
  const name = companyName.trim().replace(/\.+\s*$/, "").trim();
  if (!name) return "Perfecto. ¿En qué te puedo ayudar?";
  return `Perfecto, sigo con ${name}. ¿En qué te puedo ayudar?`;
}

/** Trámite operativo real (programar/registrar), no guía informativa. */
export function looksLikeMaintenanceExplorationRequest(raw: string | undefined | null): boolean {
  const text = normCompanyToken(raw ?? "");
  if (!text) return false;
  if (!/\b(mantenimiento|preventiv|correctiv|tarea|plan)\b/.test(text)) return false;
  if (
    /\b(programar|registrar|agendar|generar|abrir|crear|dar de alta|solicito pedir|pedir un)\b/.test(
      text,
    )
  ) {
    return false;
  }
  if (/\b(quiero|necesito|me gustaria|quisiera)\s+(saber|conocer|info|informacion)\b/.test(text)) {
    return true;
  }
  const infoCue =
    /\b(saber|conocer|informacion|consultar|entender|explicar|explicame|contame|decime|que es|como se|cómo se|como funciona|cómo funciona|como hago|cómo hago|como se hace|cómo se hace|para que sirve|modulo|guia|ayuda)\b/;
  return infoCue.test(text);
}

export function looksLikeOperationalMaintenanceIntent(raw: string, threadText = ""): boolean {
  const text = normCompanyToken(raw);
  if (looksLikeMaintenanceExplorationRequest(raw)) return false;
  if (
    /\b(quiero|necesito|solicito|pedir|registrar|programar|agendar|dejar|abrir|generar|dar de alta|puedo)\b/.test(
      text,
    ) &&
    /\b(mantenimiento|preventiv|correctiv|tarea|plan)\b/.test(text)
  ) {
    return true;
  }
  if (!looksLikeMaintenanceGuideContextInThread(threadText)) return false;
  return (
    /\b(puedo|programar|registrar|agendar|generar|hacer|crear|abrir)\b/.test(text) &&
    /\b(vos|con vos|contigo|atilio|uno|una|lo|preventivo|correctivo|con tu ayuda)\b/.test(text)
  );
}

/**
 * Tras una guía informativa: pregunta si Atilio puede registrar el mantenimiento o lo hace el cliente en Wara.
 * Ej.: «¿Vos podés generar un mantenimiento o lo hago yo?», «¿Puedo programar uno con vos?»
 */
export function looksLikeMaintenanceCapabilityQuestion(
  raw: string | undefined | null,
  threadText = "",
): boolean {
  const text = normCompanyToken(raw ?? "");
  if (!text) return false;
  if (looksLikeMaintenanceInfoRequest(raw)) return false;

  const threadHasMaintGuide = looksLikeMaintenanceGuideContextInThread(threadText);
  const maintInText = /\b(mantenimiento|preventiv|correctiv|tarea|plan|uno|una)\b/.test(text);
  const asksBotVsSelf =
    (/\b(vos|tu|atilio|bot|aca|whatsapp|por aca|con vos|contigo)\b/.test(text) &&
      /\b(podes|pod[eé]s|generar|registrar|programar|abrir|crear|hacer|agendar|haces|hac[eé]s)\b/.test(
        text,
      )) ||
    /\b(lo hago yo|hago yo|yo mismo|vos o yo|lo hago yo o vos|generar un mantenimiento o)\b/.test(
      text,
    ) ||
    (/\bpuedo\b/.test(text) &&
      /\b(programar|registrar|agendar|hacer|crear|generar)\b/.test(text) &&
      (/\b(vos|con vos|contigo|atilio)\b/.test(text) || threadHasMaintGuide));

  if (!asksBotVsSelf) return false;
  return maintInText || threadHasMaintGuide;
}

/** Mensaje del cliente con contenido (no ack vacío) — evitar ignorar turnos útiles. */
/** Consulta operativa sobre GPS, ignición, reporte o estado de unidad (no mantenimiento). */
export function looksLikeGpsOrUnitStatusQuestion(text: string | undefined | null): boolean {
  const t = normCompanyToken(text ?? "");
  if (!t || t.length > 220) return false;
  if (/\b(mantenimiento|preventiv|correctiv|tarea|plan de mantenimiento)\b/.test(t)) return false;
  const gpsUnitCue =
    /\b(gps|ignicio|ignicion|reporte|offline|ubicacion|posicion|senal|voltaje|marcado|instalado|dispositivo|equipo|seguimiento)\b/.test(
      t,
    );
  const questionCue =
    /\b(como|donde|que|cual|cuando|saber|verificar|revisar|chequear|esta|funciona|bien|mal|ver|consultar|mostrar)\b/.test(
      t,
    ) || String(text ?? "").includes("?");
  return gpsUnitCue && questionCue;
}

/** Consulta en vivo de unidad (ignición, reporte, GPS) — prioridad sobre mantenimiento/certificado. */
export function looksLikeLiveUnitConsultIntent(text: string | undefined | null): boolean {
  if (looksLikeGpsOrUnitStatusQuestion(text)) return true;
  const t = normCompanyToken(text ?? "");
  if (!t || t.length > 220) return false;
  if (/\b(mantenimiento|preventiv|correctiv|certificado|cobertura)\b/.test(t)) return false;
  if (
    /\b(quiero|necesito|dame|decime|pasame|ver|consultar|mostrar|estado)\b/.test(t) &&
    /\b(ignicio|ignicion|reporte|gps|ubicacion|posicion|unidad|flota)\b/.test(t)
  ) {
    return true;
  }
  return false;
}

/** Cliente preguntó por GPS/ignición/reporte en las últimas líneas del hilo. */
export function threadHasRecentLiveUnitConsultIntent(threadText: string): boolean {
  const tail = threadText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-10);
  return tail.some(
    (line) => looksLikeLiveUnitConsultIntent(line) || looksLikeGpsOrUnitStatusQuestion(line),
  );
}

export function looksLikeSubstantiveCustomerMessage(raw: string | undefined | null): boolean {
  const text = (raw ?? "").trim();
  if (text.length < 4) return false;
  const norm = normCompanyToken(text);
  if (
    /^(ok|si|no|gracias|muchas gracias|listo|dale|bueno|perfecto|genial|entendido|de acuerdo|confirmo)$/.test(
      norm,
    )
  ) {
    return false;
  }
  return true;
}

/** Fallback cuando el turno no produjo respuesta pero el cliente escribió algo con sentido. */
export function buildUnexpectedTurnFallbackMessage(raw: string | undefined | null): string {
  const text = normCompanyToken(raw ?? "");
  if (/\b(mantenimiento|preventiv|correctiv|tarea|plan)\b/.test(text)) {
    return (
      "Puedo ayudarte con mantenimiento por acá: decime la patente de la unidad y si es preventivo o correctivo. " +
      "Si preferís hacerlo vos en Wara, entrá a Utilidades → Mantenimiento."
    );
  }
  return (
    "Recibí tu consulta. Contame un poco más en concreto qué necesitás " +
    "(por ejemplo patente, trámite o módulo de Wara) y te guío."
  );
}

/** Guía informativa del módulo Mantenimiento (cómo usar/configurar), no trámite operativo. */
export function looksLikeMaintenanceInfoRequest(raw: string | undefined | null): boolean {
  const text = normCompanyToken(raw ?? "");
  if (!text) return false;
  if (looksLikeMaintenanceExplorationRequest(raw)) return true;
  if (looksLikeOperationalMaintenanceIntent(String(raw ?? ""))) return false;
  if (looksLikeTurnoOrAgendaQuestion(String(raw ?? ""))) return false;
  if (looksLikeOpcionesInfoRequest(raw)) return false;
  if (looksLikeUnidadesInfoRequest(raw)) return false;
  const maintenanceDomain =
    /\b(mantenimiento|preventiv|correctiv|tarea|plan|combustible|rendimiento|consumo|neumatic|rfid|cubierta|averia|falla|orden de trabajo)\b/;
  const howToCue =
    /\b(como|ensena|explica|ayuda|paso a paso|configur|crear|cargar|usar|utilizar|modulo|funciona|saber|conocer|informacion|como se|cómo se|como hago|cómo hago)\b/;
  return maintenanceDomain.test(text) && howToCue.test(text);
}

/** Turno/agenda de Opciones Wara, no mantenimiento operativo de unidades. */
export function looksLikeTurnoOrAgendaQuestion(raw: string): boolean {
  const text = normCompanyToken(raw);
  if (/\b(mantenimiento|preventiv|correctiv|tarea|plan)\b/.test(text)) return false;
  return /\b(turno|turnos|agenda)\b/.test(text);
}

/** Guía informativa de mantenimiento ya respondida en el hilo reciente. */
export function looksLikeMaintenanceInfoGuideInThread(threadText: string): boolean {
  const tail = threadText.slice(-3500).toLowerCase();
  return (
    /modulo de mantenimiento/.test(tail) &&
    (/orientacion de uso|como guia general|tarea preventiva|tarea correctiva|paso a paso/.test(tail) ||
      /queres que te explique/.test(tail) ||
      /no genero un ticket por esta consulta/.test(tail))
  );
}

/** Contexto de guía de mantenimiento (backend o BBC/ChatPDF). */
export function looksLikeMaintenanceGuideContextInThread(threadText: string): boolean {
  if (!threadText.trim()) return false;
  if (looksLikeMaintenanceInfoGuideInThread(threadText)) return true;
  const tail = threadText.slice(-4000).toLowerCase();
  return (
    /mantenimiento preventivo/.test(tail) ||
    (/mantenimiento/.test(tail) &&
      /utilidades|plan de mantenimiento|tarea correctiva|tarea preventiva|ingresa al sistema wara|ingresar al sistema/.test(
        tail,
      )) ||
    (/queres que te explique/.test(tail) && /mantenimiento|preventiv|correctiv|tarea/.test(tail))
  );
}

/** Invocación espuria del ejecutor de mantenimiento (p. ej. reproceso tras guía Opciones). */
export function shouldSkipStrayMaintenanceRequest(
  text: string,
  threadText: string,
  opts: {
    pendingPlateRequest: boolean;
    pendingMaintConfirm: boolean;
    lastInbound?: string;
  }
): boolean {
  if (opts.pendingPlateRequest || opts.pendingMaintConfirm) return false;
  if (
    hasPendingMaintenancePlateRequest(threadText) &&
    (isBarePlatePrefixHint(text) ||
      !!detectLoosePlate(text) ||
      !!extractPlatePrefixFromMessage(text))
  ) {
    return false;
  }
  if (looksLikeOperationalMaintenanceIntent(text, threadText)) return false;
  if (looksLikeMaintenanceCapabilityQuestion(text, threadText)) return false;
  if (looksLikeTurnoOrAgendaQuestion(text)) return true;
  if (looksLikeOpcionesInfoRequest(text)) return true;
  if (looksLikeUnidadesInfoRequest(text)) return true;
  if (opts.lastInbound && looksLikeOpcionesInfoRequest(opts.lastInbound)) return true;
  if (opts.lastInbound && looksLikeUnidadesInfoRequest(opts.lastInbound)) return true;
  if (looksLikePlatformInfoGuideInThread(threadText)) return true;
  if (
    looksLikeMaintenanceGuideContextInThread(threadText) &&
    !looksLikeMaintenanceCapabilityQuestion(text, threadText) &&
    !looksLikeOperationalMaintenanceIntent(text, threadText)
  ) {
    return true;
  }
  if (isGenericMaintenanceFallbackText(text)) return true;
  return false;
}

export function looksLikeGreeting(text: string | undefined | null): boolean {
  const norm = normCompanyToken(text ?? "");
  if (!norm) return true;
  return /^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|que tal|menu|inicio)$/.test(
    norm
  );
}

/** Saludo repetido en una conversación que ya venía en curso (no primer contacto). */
export function looksLikeRepeatGreetingInSession(
  threadText: string,
  selectionText: string | undefined | null,
): boolean {
  if (!looksLikeGreeting(selectionText) || !threadText.trim()) return false;
  const tail = threadText.slice(-3500).toLowerCase();
  return (
    /atilio|mesa de ayuda wara|seguimos|en qu[eé] te puedo|consulta o servicio|voy a registrar|ten[eé]s \d+ unidades|listo,\s*registr|patente:/.test(
      tail,
    )
  );
}

/** Cliente pide abrir reclamo/ticket/caso (no consulta GPS ni unidad). */
export function looksLikeExplicitReclamoOrTicketRequest(text: string | undefined | null): boolean {
  const n = normCompanyToken(text ?? "");
  if (!n || n.length > 200) return false;
  if (looksLikeHumanAdvisorRequest(text)) return false;
  if (/\b(caso|ticket|reclamo)\s+(abierto|activo|pendiente)\b/.test(n)) return false;
  if (/\b(cerrar|cerrame|resolver)\s+(caso|ticket|reclamo)\b/.test(n)) return false;

  if (
    /\b(gps|reporte|ignicion|offline|ubicacion|ultimo reporte|no reporta|sin reporte|patente|matricula)\b/.test(
      n,
    ) &&
    /\b(falla|problema|averia|no reporta|offline|sin señal)\b/.test(n)
  ) {
    return false;
  }
  if (detectLoosePlate(text ?? "") && /\b(falla|problema|averia|no reporta|offline)\b/.test(n)) {
    return false;
  }

  if (
    /\b(reclamo|ticket)\b/.test(n) &&
    /\b(hacer|abrir|generar|crear|levantar|presentar|tengo un|tengo una|por|nuevo)\b/.test(n)
  ) {
    return true;
  }
  if (/\b(abrir|crear|generar|levantar)\s+(un\s+)?(ticket|caso|reclamo)\b/.test(n)) return true;
  if (/\b(necesito|quiero)\s+(un\s+)?(ticket|reclamo|caso)\b/.test(n)) return true;
  return false;
}

/** Pide explícitamente hablar con una persona / escalar a humano. */
export function looksLikeHumanAdvisorRequest(text: string | undefined | null): boolean {
  const norm = normCompanyToken(text ?? "");
  if (!norm) return false;
  if (/^(asesor|agente|operador|humano|humana|persona)[\s!.,]*$/.test(norm)) return true;
  if (
    /\b(escalar|derivar)\b/.test(norm) &&
    /\b(asesor|agente|persona|humano|humana|operador|representante|supervisor|atencion)\b/.test(norm)
  ) {
    return true;
  }
  const wantsHuman =
    /\b(asesor|agente|persona|humano|humana|operador|representante|supervisor)\b/.test(norm) ||
    /\b(hablar con|comunicarme|comunicar con|contactar con|pasar con|pasame con|derivar|escalar)\b/.test(
      norm
    );
  const intent =
    /\b(quiero|necesito|pod[eé]s|podes|me gustar[ií]a|dame|pasame|pas[aá]me|solicito|por favor)\b/.test(norm) ||
    /\b(comunicarme|contactar|hablar)\b/.test(norm);
  return wantsHuman && (intent || /\b(asesor humano|atenci[oó]n humana|agente humano)\b/.test(norm));
}

/**
 * Pregunta si Atilio/el bot puede ayudar (no pide explícitamente un humano).
 * Ej.: "¿vos no me podés ayudar?", "¿me podés ayudar con esto?"
 */
export function looksLikeAtilioHelpRequest(text: string | undefined | null): boolean {
  const norm = normCompanyToken(text ?? "");
  if (!norm || norm.length > 160) return false;
  if (looksLikeHumanAdvisorRequest(text)) return false;

  if (/\b(por que|porque|por qué)\s+me\s+deriv/.test(norm)) return true;
  if (/\bno\s+me\s+(deriv|pases|pase)\b/.test(norm)) return true;

  const asksForHelp =
    /\b(me\s+)?(podes|pod[eé]s|puede)\s+(ayudar|ayudarme)\b/.test(norm) ||
    /\b(ayudarme|ayudame|ayudáme|ayudame)\b/.test(norm);
  if (!asksForHelp) return false;

  if (/\b(asesor|agente|persona|humano|humana|operador)\b/.test(norm)) return false;

  return (
    /\b(vos|tu|atilio|bot|chatbot)\b/.test(norm) ||
    /\bno\s+me\s+(podes|pod[eé]s)\s+ayudar\b/.test(norm) ||
    /\bme\s+(podes|pod[eé]s)\s+ayudar\b/.test(norm)
  );
}

export function buildAtilioHelpCapabilitiesReply(firstName?: string): string {
  const prefix = firstName?.trim() ? `${firstName.trim()}, ` : "";
  return (
    `${prefix}sí, puedo ayudarte por este chat con consultas de unidades (reporte, ubicación, flota), certificados de cobertura, odómetro/horómetro y mantenimiento. ` +
    `Contame qué necesitás — por ejemplo "reporte de LWK7902" o "listado de mis unidades". ` +
    `Si preferís hablar con una persona, escribí "hablar con un asesor".`
  );
}

function companySelectionMenuMessage(
  menu: string,
  opts?: { unrecognized?: boolean }
): string {
  const intro = opts?.unrecognized
    ? "No reconocí esa opción. ¿De cuál empresa escribís?"
    : "Veo que este número está asociado a más de una empresa en Wara. ¿De cuál escribís?";
  return `${intro}\n\n${menu}\n\nRespondé con el número de la opción o con el nombre de la empresa.`;
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

function applyTestContactAliases(
  lookup: WaraEmpresaLookupResult,
  rawPhone: string
): WaraEmpresaLookupResult {
  const aliases = resolvePruebasContactAliases(rawPhone);
  if (!aliases?.length) return lookup;

  const waraName =
    lookup.customerName?.trim() ||
    lookup.contactos.find((c) => c.nombre.trim())?.nombre.trim() ||
    "";

  const contactos: WaraEmpresaContact[] = aliases.map((alias) => ({
    id: alias.contactoId,
    empresa: alias.empresa,
    nombre: waraName || alias.empresa,
  }));

  const multi = contactos.length > 1;
  console.log(
    `[WaraAPI] Pruebas contact aliases aplicado a ${normalizeWhatsAppPhone(rawPhone)}: ` +
      contactos.map((c) => `${c.id}=${c.empresa}`).join(", ")
  );

  return {
    ...lookup,
    configured: lookup.configured || obtenerEmpresaToken().length > 0,
    ok: true,
    encontrado: true,
    contactos,
    sessionToken: multi ? undefined : lookup.sessionToken,
    customerName: lookup.customerName || waraName || undefined,
    error: undefined,
  };
}

/** @deprecated Usar isPruebasContactAliasesActive desde @/config/pruebasContactAliases */
export function isTestContactAliasesEnabled(): boolean {
  return isPruebasContactAliasesActive();
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

const WARA_SESSION_TTL_MS = 45 * 60 * 1000;

const waraSessionInflight = new Map<
  string,
  Promise<{
    ok: boolean;
    status: number;
    sessionToken?: string;
    customerId?: number;
    customerName?: string;
    userTimezone?: string;
    customerTimezone?: string;
    error?: string;
  }>
>();

function isWaraSessionFresh(at: Date | null | undefined): boolean {
  if (!at) return false;
  return Date.now() - at.getTime() < WARA_SESSION_TTL_MS;
}

function waraApiBaseCandidates(): string[] {
  const primary = waraApiBaseUrl();
  const maintenance = waraMaintenanceApiBaseUrl();
  return primary === maintenance ? [primary] : [primary, maintenance];
}

async function readCachedWaraSession(
  prisma: PrismaClient,
  rawPhone: string,
  contactId: number
): Promise<string | null> {
  const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
  if (!customer?.waraSessionToken?.trim()) return null;
  if (customer.selectedCompanyContactId !== contactId) return null;
  if (!isWaraSessionFresh(customer.waraSessionAt)) return null;
  return customer.waraSessionToken.trim();
}

async function persistWaraSession(
  prisma: PrismaClient,
  rawPhone: string,
  contactId: number,
  sessionToken: string
): Promise<void> {
  const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
  if (!customer) return;
  await prisma.customer.update({
    where: { id: customer.id },
    data: {
      waraSessionToken: sessionToken,
      waraSessionAt: new Date(),
      selectedCompanyContactId: contactId,
    },
  });
}

async function clearWaraSessionCache(prisma: PrismaClient, customerId: string): Promise<void> {
  await prisma.customer.update({
    where: { id: customerId },
    data: { waraSessionToken: null, waraSessionAt: null },
  });
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
  /** Aviso cuando WARA_PRUEBAS_FALLBACK_EL_CACIQUE redirige a otra empresa con sesión válida. */
  pruebasFallbackNote?: string;
  error?: string;
  lookup?: WaraEmpresaLookupResult | null;
};

export type WaraUnidadEstado = {
  movil_id: number;
  /** Nombre de la unidad en Wara (backoffice: columna Nombre, ej. M300-111). No es el Interno (003-111). */
  unidad: string;
  /** Matrícula / patente (backoffice: Matrícula, ej. NKL 952). */
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

    // Caso bueno: Wara respondió con contactos. Listo (aliases de prueba pueden reemplazar IDs).
    if (result.ok && result.encontrado && result.contactos.length > 0) {
      return applyTestContactAliases(result, rawPhone);
    }

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

  return applyTestContactAliases(last as WaraEmpresaLookupResult, rawPhone);
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

  // CreateChatBotToken es intermitente del lado de Wara. Reintentamos ante fallo transitorio.
  const maxAttempts = 3;
  const backoffMs = [400, 900];
  let lastError = `Wara no devolvió SessionToken (contacto ${contactId})`;
  let lastStatus = 503;
  const bases = waraApiBaseCandidates();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    for (const base of bases) {
      let res: Response;
      let json: Record<string, unknown> | null = null;
      try {
        res = await fetch(`${base}/CreateChatBotToken`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, contacto_id: contactId }),
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
        });
        json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      } catch (error) {
        lastError =
          error instanceof Error ? error.message : "Error de red llamando a CreateChatBotToken";
        lastStatus = 502;
        console.error(
          `[WaraAPI] CreateChatBotToken intento ${attempt}/${maxAttempts} base=${base} falló (red) contacto=${contactId}: ${lastError}`
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
        `[WaraAPI] CreateChatBotToken intento ${attempt}/${maxAttempts} base=${base} sin token contacto=${contactId} status=${res.status}: ${lastError}`
      );
      if (res.status < 500) break;
    }
    if (attempt < maxAttempts) {
      await sleep(backoffMs[attempt - 1] ?? 900);
    }
  }

  return { ok: false, status: lastStatus, error: lastError };
}

async function ensureWaraSessionForContact(
  prisma: PrismaClient,
  rawPhone: string,
  contact: WaraEmpresaContact
): Promise<{
  ok: boolean;
  status: number;
  sessionToken?: string;
  customerId?: number;
  customerName?: string;
  userTimezone?: string;
  customerTimezone?: string;
  error?: string;
}> {
  const cached = await readCachedWaraSession(prisma, rawPhone, contact.id);
  if (cached) {
    return { ok: true, status: 200, sessionToken: cached };
  }

  const inflightKey = `${rawPhone}:${contact.id}`;
  const inflight = waraSessionInflight.get(inflightKey);
  if (inflight) return inflight;

  const promise = (async () => {
    const cachedAgain = await readCachedWaraSession(prisma, rawPhone, contact.id);
    if (cachedAgain) {
      return { ok: true, status: 200, sessionToken: cachedAgain };
    }

    const created = await createChatBotToken(contact.id);
    if (created.ok && created.sessionToken) {
      await persistWaraSession(prisma, rawPhone, contact.id, created.sessionToken);
      return created;
    }
    return created;
  })().finally(() => {
    waraSessionInflight.delete(inflightKey);
  });

  waraSessionInflight.set(inflightKey, promise);
  return promise;
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

/** Modo prueba: si Wara no abre sesión para la empresa elegida, usar otra del mismo teléfono. */
function isPruebasFallbackEnabled(): boolean {
  const v = process.env.WARA_PRUEBAS_FALLBACK_EL_CACIQUE?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "si";
}

async function findPruebasFallbackContact(
  contacts: WaraEmpresaContact[],
  excludeContactId: number
): Promise<{
  contact: WaraEmpresaContact;
  sessionToken: string;
  customerId?: number;
  customerName?: string;
  userTimezone?: string;
  customerTimezone?: string;
} | null> {
  for (const contact of contacts) {
    if (contact.id === excludeContactId) continue;
    const created = await createChatBotToken(contact.id);
    if (created.ok && created.sessionToken) {
      return {
        contact,
        sessionToken: created.sessionToken,
        customerId: created.customerId,
        customerName: created.customerName,
        userTimezone: created.userTimezone,
        customerTimezone: created.customerTimezone,
      };
    }
  }
  return null;
}

function pruebasFallbackNoteMessage(blockedCompany: string, fallbackCompany: string): string {
  return (
    `⚠️ Modo prueba: Wara no abrió sesión para ${blockedCompany}. ` +
    `Continuamos con ${fallbackCompany} hasta que Wara habilite ese contacto.`
  );
}

function isHardWaraSessionError(status: number, error?: string): boolean {
  const e = normCompanyToken(error ?? "");
  if (status === 401 || status === 403) return true;
  return /inexistente|no autorizado|token invalido|no habilito|contacto invalido/.test(e);
}

/** Caída/intermitencia de Wara (502/503/red): no bloquear elección de empresa. */
function isTransientWaraSessionError(status: number, error?: string): boolean {
  if (isHardWaraSessionError(status, error)) return false;
  if (status >= 500 || status === 0) return true;
  const e = normCompanyToken(error ?? "");
  return /502|503|504|timeout|error de red|gateway|intermitente|http 5/.test(e);
}

function softCompanySelectDuringWaraOutageMessage(company: string): string {
  return (
    `Listo, sigo con ${company}. Wara tiene una interrupción temporal en sus servidores; ` +
    `las guías de plataforma (Opciones, Unidades, etc.) siguen disponibles por este chat. ` +
    `Para consultar unidades u otros trámites en vivo, probá de nuevo en unos minutos.\n\n` +
    `¿En qué te puedo ayudar?`
  );
}

function formatWaraSessionFailureMessage(
  company: string,
  contactId: number,
  waraErr: string,
  menu: string
): string {
  return (
    `No pude abrir sesión en Wara para ${company} (contacto ${contactId}): ${waraErr}\n\n` +
    `${menu}\n\nProbá con otra opción o contactá soporte si el error persiste.`
  );
}


export function formatContactsMenu(contacts: WaraEmpresaContact[]): string {
  return contacts.map((c, i) => `${i + 1}. ${c.empresa || c.nombre}`).join("\n");
}

/** Menú numerado con todas las empresas que devuelve Wara para ese teléfono. */
export async function buildCompanyMenuPayload(
  contacts: WaraEmpresaContact[],
  _cacheKey?: string
): Promise<{
  menuContacts: WaraEmpresaContact[];
  waraContactsText: string;
  requiresSelection: boolean;
}> {
  const waraContactsText = contacts.length ? formatContactsMenu(contacts) : "";
  return {
    menuContacts: contacts,
    waraContactsText,
    requiresSelection: waraRequiresCompanyConfirmation(contacts),
  };
}

/** Hay que elegir cuando Wara devuelve más de un contacto para el mismo teléfono. */
export function waraRequiresCompanyConfirmation(allContacts: WaraEmpresaContact[]): boolean {
  return allContacts.length > 1;
}

export function waraCanAutoSelectCompany(allContacts: WaraEmpresaContact[]): boolean {
  return allContacts.length === 1;
}

/** Limpia la empresa guardada y devuelve el menú Wara (usado por Cambiar empresa). */
export async function resetCustomerCompanyMenu(
  prisma: PrismaClient,
  rawPhone: string
): Promise<{
  message: string;
  waraContactsText: string;
  requiresCompanySelection: boolean;
  contacts: WaraEmpresaContact[];
}> {
  const normalized = normalizeWhatsAppPhone(rawPhone);
  const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
  if (customer) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        companyName: "",
        selectedCompanyContactId: null,
        waraSessionToken: null,
        waraSessionAt: null,
      },
    });
  }
  const lookup = await obtenerEmpresaPorNumero(rawPhone);
  const contacts = lookup.contactos ?? [];
  const menu = contacts.length
    ? await buildCompanyMenuPayload(contacts, normalized)
    : null;
  const waraContactsText = menu?.waraContactsText ?? "";
  const multi = waraRequiresCompanyConfirmation(contacts);
  const message = multi
    ? `Listo, reinicié la empresa. ¿Con cuál seguimos?\n\n${waraContactsText}\n\nRespondé con el número de la opción o con el nombre de la empresa.`
    : waraCanAutoSelectCompany(contacts)
      ? `Tu número tiene una sola empresa asociada (${contacts[0].empresa || contacts[0].nombre}). ¿En qué te puedo ayudar?`
      : `No encontré empresas asociadas a tu número en Wara. Te derivo con un agente.`;
  return {
    message,
    waraContactsText,
    requiresCompanySelection: multi,
    contacts,
  };
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
    const inlineContact = findContactForCompany(
      resolution.lookup.contactos,
      resolution.selectedCompanyName ?? resolution.customer?.companyName,
      resolution.customer?.selectedCompanyContactId
    );
    if (inlineContact) {
      await persistWaraSession(prisma, rawPhone, inlineContact.id, resolution.lookup.sessionToken);
    }
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
    resolution.selectedCompanyName ?? resolution.customer?.companyName,
    resolution.customer?.selectedCompanyContactId
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

  const created = await ensureWaraSessionForContact(prisma, rawPhone, selectedContact);
  if (!created.ok || !created.sessionToken) {
    const companyLabel =
      resolution.selectedCompanyName ?? selectedContact.empresa ?? "";
    if (isPruebasFallbackEnabled()) {
      const fallback = await findPruebasFallbackContact(
        resolution.lookup.contactos,
        selectedContact.id
      );
      if (fallback) {
        const fallbackCompany = fallback.contact.empresa || fallback.contact.nombre;
        const normalized = normalizeWhatsAppPhone(rawPhone);
        const local = await findCustomerByWhatsAppNumber(prisma, rawPhone);
        if (local) {
          await prisma.customer.update({
            where: { id: local.id },
            data: {
              companyName: fallbackCompany,
              selectedCompanyContactId: fallback.contact.id,
              waraSessionToken: fallback.sessionToken,
              waraSessionAt: new Date(),
            },
          });
        } else if (normalized.length >= 8) {
          await prisma.customer.create({
            data: {
              phone: normalized,
              companyName: fallbackCompany,
              selectedCompanyContactId: fallback.contact.id,
              waraSessionToken: fallback.sessionToken,
              waraSessionAt: new Date(),
            },
          });
        }
        const note = pruebasFallbackNoteMessage(companyLabel || "esa empresa", fallbackCompany);
        console.warn(
          `[WaraAPI] Modo prueba: fallback de sesión ${companyLabel} -> ${fallbackCompany} (contacto ${fallback.contact.id})`
        );
        return {
          ok: true,
          status: 200,
          sessionToken: fallback.sessionToken,
          customerName: fallback.customerName ?? resolution.lookup.customerName,
          companyName: fallbackCompany,
          contactName: resolution.customer?.name?.trim() || fallback.contact.nombre || "",
          pruebasFallbackNote: note,
          lookup: {
            ...resolution.lookup,
            sessionToken: fallback.sessionToken,
            customerId: fallback.customerId ?? resolution.lookup.customerId,
            customerName: fallback.customerName ?? resolution.lookup.customerName,
            userTimezone: fallback.userTimezone ?? resolution.lookup.userTimezone,
            customerTimezone:
              fallback.customerTimezone ?? resolution.lookup.customerTimezone,
          },
        };
      }
    }
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
      resolution.selectedCompanyName ??
      selectedContact.empresa ??
      resolution.customer?.companyName?.trim() ??
      created.customerName ??
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

function normalizeWaraErrorText(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Errores de patente/unidad inexistente o sin permiso: no escalan a Odoo ni abren ticket. */
export function isWaraPlateValidationError(params: {
  status?: number;
  error?: string;
}): boolean {
  const err = normalizeWaraErrorText(params.error);
  if (
    /no se encontr|no encontr|unidad no encontr|vehiculo no encontr|veh[ií]culo no encontr|patente no encontr|no existe la unidad|no existe el vehiculo|patente invalida|matricula invalida|formato de patente|sin permiso|no autoriz|no pertenece|no asignad|no corresponde a/.test(
      err
    )
  ) {
    return true;
  }
  if (params.status === 404) return true;
  if (params.status === 400 && err.length > 0) {
    if (/validacion|validation|bad request|http 400/.test(err)) return true;
    if (
      /unidad|vehiculo|patente|matricula|movil|flota/.test(err) &&
      !/servidor|interno|timeout|mantenimiento programado/.test(err)
    ) {
      return true;
    }
  }
  return false;
}

/** Etiqueta legible para tickets Odoo cuando sí escala (no validación del cliente). */
export function waraCertificateFailureCategory(error: string | undefined, status?: number): string {
  if (isWaraPlateValidationError({ status, error })) {
    return "Error de validación de matrícula";
  }
  const err = normalizeWaraErrorText(error);
  if (/requisito|habilit|cobertura|monitoreo|vencid|suspendid|bloquead/.test(err)) {
    return "Rechazo de negocio (certificado no aplicable)";
  }
  if (/permiso|autoriz/.test(err)) return "Sin permisos para la operación";
  return "Certificado no emitido por Wara";
}

export type PlateFleetValidationPurpose = "certificate" | "maintenance" | "odometer";

function plateMatchesFleetUnit(wanted: string, unit: WaraUnidadEstado): boolean {
  const matchField = (unitPlate: string | null | undefined) => {
    if (!unitPlate) return false;
    const unitNorm = normalizePlate(unitPlate);
    if (!unitNorm) return false;
    if (unitNorm === wanted || unitNorm.includes(wanted) || wanted.includes(unitNorm)) return true;
    if (unitNorm.length === wanted.length) {
      let diffs = 0;
      for (let i = 0; i < wanted.length; i++) {
        if (unitNorm[i] !== wanted[i]) diffs++;
      }
      if (diffs === 1) return true;
    }
    return false;
  };
  return matchField(unit.patente) || matchField(unit.unidad);
}

/** Busca una unidad en flota Wara por matrícula o nombre (tolera espacios y guiones). */
export async function findFleetUnitByPlate(
  sessionToken: string,
  plate: string,
): Promise<WaraUnidadEstado | null> {
  const wanted = normalizePlate(plate);
  if (!wanted) return null;

  const lookupKeys = Array.from(
    new Set(
      [plate.trim(), formatPlateWithSpaces(plate), wanted].filter(
        (value): value is string => !!value?.trim(),
      ),
    ),
  );
  for (const key of lookupKeys) {
    const scoped = await consultarEstadoUnidades(sessionToken, [key]);
    if (!scoped.ok) continue;
    const hit = scoped.unidades.find((unit) => plateMatchesFleetUnit(wanted, unit));
    if (hit) return hit;
  }

  const full = await consultarEstadoUnidades(sessionToken, []);
  if (!full.ok) return null;
  return full.unidades.find((unit) => plateMatchesFleetUnit(wanted, unit)) ?? null;
}

/** Consulta flota Wara antes de trámites operativos; evita tickets por typos de patente. */
export async function validatePlateInFleetForPhone(
  prisma: PrismaClient,
  rawPhone: string,
  plate: string,
  companyName: string,
  purpose: PlateFleetValidationPurpose = "maintenance"
): Promise<{ found: boolean; checked: boolean; message?: string }> {
  const session = await resolveWaraSessionByPhone(prisma, rawPhone);
  if (!session.ok || !session.sessionToken) {
    return { found: true, checked: false };
  }
  const plateDisplay = formatPlateWithSpaces(plate) ?? plate;
  const result = await consultarEstadoUnidades(session.sessionToken, [plateDisplay]);
  if (!result.ok) return { found: true, checked: false };

  const wanted = normalizePlate(plate);
  if (!wanted) return { found: true, checked: false };

  let foundUnit: WaraUnidadEstado | null = null;
  if (result.unidades.length > 0) {
    foundUnit = result.unidades.find((unit) => plateMatchesFleetUnit(wanted, unit)) ?? null;
  }
  if (!foundUnit) {
    const full = await consultarEstadoUnidades(session.sessionToken, []);
    if (full.ok && full.unidades.length > 0) {
      foundUnit = full.unidades.find((unit) => plateMatchesFleetUnit(wanted, unit)) ?? null;
    }
  }
  if (foundUnit) return { found: true, checked: true };

  const multi = (session.lookup?.contactos.length ?? 0) > 1;
  if (purpose === "certificate" || purpose === "odometer") {
    const tramite = purpose === "odometer" ? "registrar el odómetro" : "pedir el certificado";
    const message = multi
      ? `No encontré la patente ${plateDisplay} en las unidades de ${companyName}. Revisá que esté bien escrita. Si la unidad es de otra de tus empresas, escribí "cambiar empresa", elegí la correcta y volvé a ${tramite}.`
      : `No encontré la patente ${plateDisplay} entre las unidades activas de ${companyName}. Revisá que esté bien escrita e intentá de nuevo.`;
    return { found: false, checked: true, message };
  }

  const message = multi
    ? `No encontré la patente ${plateDisplay} en las unidades de ${companyName}. Puede que esa unidad esté en otra de tus empresas: escribí "cambiar empresa", elegí la correcta y volvé a pasarme la patente. Si igual querés registrar la gestión en ${companyName}, respondé con la patente y un breve detalle del trabajo.`
    : `No encontré la patente ${plateDisplay} entre las unidades activas de ${companyName}. Revisá que esté bien escrita o contame un poco más del trabajo que querés programar para esa unidad.`;
  return { found: false, checked: true, message };
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

  // Menú si Wara tiene 2+ contactos y falta elegir; auto-solo con 1 contacto en Wara.
  const previouslySelected = local?.companyName?.trim() || null;
  const storedContactId = local?.selectedCompanyContactId ?? null;
  let chosenCompany: string | null = null;
  let chosenContact: WaraEmpresaContact | null = null;

  const { menuContacts, requiresSelection: menuRequiresSelection } =
    await buildCompanyMenuPayload(lookup.contactos, normalized);

  if (storedContactId != null) {
    chosenContact = lookup.contactos.find((c) => c.id === storedContactId) ?? null;
  }
  if (!chosenContact && previouslySelected) {
    chosenContact = findContactForCompany(
      lookup.contactos,
      previouslySelected,
      storedContactId
    );
  }
  if (chosenContact) {
    chosenCompany = chosenContact.empresa || chosenContact.nombre;
  } else if (waraCanAutoSelectCompany(lookup.contactos)) {
    chosenContact = lookup.contactos[0];
    chosenCompany = chosenContact.empresa || chosenContact.nombre;
  }

  // Wara puede devolver el nombre del contacto (persona); lo guardamos como name del Customer
  // si todavía no tenemos uno.
  const waraContactName =
    lookup.contactos.length === 1 ? lookup.contactos[0].nombre.trim() : "";

  const data: {
    phone: string;
    name?: string;
    companyName?: string;
    selectedCompanyContactId?: number | null;
  } = {
    phone: normalized,
  };
  const newName = opts?.contactName?.trim() || waraContactName || "";
  if (newName && (!local?.name || local.name.trim() !== newName)) {
    data.name = newName;
  }
  if (chosenCompany) {
    data.companyName = chosenCompany;
  }
  if (chosenContact) {
    data.selectedCompanyContactId = chosenContact.id;
  } else if (local?.selectedCompanyContactId != null) {
    data.selectedCompanyContactId = null;
  }

  const customer = local
    ? await prisma.customer.update({ where: { id: local.id }, data })
    : await prisma.customer.create({ data });

  let requiresCompanySelection = menuRequiresSelection && !chosenCompany;
  if (local?.selectedCompanyContactId != null && chosenContact?.id === local.selectedCompanyContactId) {
    requiresCompanySelection = false;
  }

  if (requiresCompanySelection) {
    console.log(
      `[WaraAPI] ${normalized} tiene ${menuContacts.length} empresa(s) seleccionable(s) en Wara; falta confirmar cuál.`
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
  const leadingNumberMatch =
    wantedRaw.match(/^\s*(?:opci[oó]n\s*)?(\d{1,3})\s*(?:[).:\-]\s*)/i) ||
    wantedRaw.match(/^\s*(?:opci[oó]n\s*)?(\d{1,3})\s*$/i);
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

  const allContacts = lookup.contactos;

  const wantedNameNorm = normCompanyToken(wantedName);

  const matched =
    (wantedId != null ? allContacts.find((c) => c.id === wantedId) : undefined) ??
    (wantedIndex != null && wantedIndex >= 0 && wantedIndex < allContacts.length
      ? allContacts[wantedIndex]
      : undefined) ??
    (wantedNameNorm
      ? allContacts.find((c) => contactMatchesSelection(c, wantedNameNorm))
      : undefined);

  async function persistCompanyChoice(contact: WaraEmpresaContact) {
    const company = contact.empresa || contact.nombre;
    const local = await findCustomerByWhatsAppNumber(prisma, rawPhone);
    const customer = local
      ? await prisma.customer.update({
          where: { id: local.id },
          data: {
            companyName: company,
            selectedCompanyContactId: contact.id,
          },
        })
      : await prisma.customer.create({
          data: {
            phone: normalized,
            companyName: company,
            selectedCompanyContactId: contact.id,
          },
        });
    return { customer, company, contact };
  }

  if (!matched) {
    const menu = formatContactsMenu(allContacts);
    return {
      ok: false,
      customer: null,
      status: 409,
      error: "La empresa indicada no figura entre las asociadas a este teléfono",
      contacts: lookup.contactos,
      menuMessage: menu
        ? companySelectionMenuMessage(menu, {
            unrecognized: !looksLikeGreeting(wantedName),
          })
        : undefined,
    };
  }

  const matchedCompany = matched.empresa || matched.nombre;
  const local = await findCustomerByWhatsAppNumber(prisma, rawPhone);

  async function finishCompanySelect(contact: WaraEmpresaContact, menuMessage?: string) {
    const saved = await persistCompanyChoice(contact);
    const label = contact.empresa || contact.nombre;
    return {
      ok: true as const,
      customer: saved.customer,
      status: 200,
      matchedContact: contact,
      contacts: lookup.contactos,
      menuMessage: menuMessage ?? formatCompanyConfirmMessage(label),
    };
  }

  if (local?.selectedCompanyContactId === matched.id) {
    const session = await ensureWaraSessionForContact(prisma, rawPhone, matched);
    if (session.ok && session.sessionToken) {
      return finishCompanySelect(matched, `Estás operando con ${matchedCompany}. ¿En qué te puedo ayudar?`);
    }
    if (isTransientWaraSessionError(session.status, session.error)) {
      console.warn(
        `[WaraAPI] Wara intermitente al revalidar ${matchedCompany} (contacto ${matched.id}); empresa guardada igual.`
      );
      return finishCompanySelect(matched, softCompanySelectDuringWaraOutageMessage(matchedCompany));
    }
  }

  const sessionProbe = await ensureWaraSessionForContact(prisma, rawPhone, matched);
  if (!sessionProbe.ok || !sessionProbe.sessionToken) {
    if (isPruebasFallbackEnabled()) {
      const fallback = await findPruebasFallbackContact(allContacts, matched.id);
      if (fallback) {
        const saved = await persistCompanyChoice(fallback.contact);
        const fallbackLabel = fallback.contact.empresa || fallback.contact.nombre;
        console.warn(
          `[WaraAPI] Modo prueba: fallback al elegir empresa ${matchedCompany} -> ${fallbackLabel} (contacto ${fallback.contact.id})`
        );
        return {
          ok: true,
          customer: saved.customer,
          status: 200,
          matchedContact: fallback.contact,
          contacts: lookup.contactos,
          menuMessage: `${pruebasFallbackNoteMessage(matchedCompany, fallbackLabel)}\n\n¿En qué te puedo ayudar?`,
        };
      }
    }
    if (isTransientWaraSessionError(sessionProbe.status, sessionProbe.error)) {
      console.warn(
        `[WaraAPI] Wara intermitente al elegir ${matchedCompany} (contacto ${matched.id}); empresa guardada sin SessionToken.`
      );
      return finishCompanySelect(matched, softCompanySelectDuringWaraOutageMessage(matchedCompany));
    }
    const menu = formatContactsMenu(allContacts);
    const waraErr = sessionProbe.error?.trim() || "Wara no devolvió SessionToken";
    return {
      ok: false,
      customer: null,
      status: sessionProbe.status >= 400 ? sessionProbe.status : 502,
      error: waraErr,
      contacts: lookup.contactos,
      matchedContact: matched,
      menuMessage: formatWaraSessionFailureMessage(matchedCompany, matched.id, waraErr, menu),
    };
  }

  return finishCompanySelect(matched);
}
