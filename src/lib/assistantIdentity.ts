import { withMediaUrlMarker } from "@/lib/mediaUrlMarker";
import { unregisteredPhoneGuidePdfUrl } from "@/lib/unregisteredPhoneHandoff";

/** Identidad oficial elegida por el cliente para el asistente de Wara. */
export const WARA_ASSISTANT_NAME = "Kira";

export function buildAssistantIdentityReply(): string {
  return `Soy ${WARA_ASSISTANT_NAME}, la asistente virtual de Wara. ¿En qué te puedo ayudar?`;
}

function normIdentityText(text: string | undefined | null): string {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[¡!¿?.,;:"'`´]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Solo presentación social del bot (quién sos / presentate / cómo te llamás).
 * NO incluye “cómo ingreso”, “reconocé que soy cliente”, etc. — eso no es identidad.
 * Bug prod 2026-09-15: el LLM de frontera marcaba esos pedidos como identidad_asistente
 * y Kira respondía en loop «Soy Kira…».
 */
export function looksLikeAssistantIdentityQuestion(
  text: string | undefined | null,
): boolean {
  const n = normIdentityText(text);
  if (!n || n.length > 80) return false;

  if (
    /^(presentate|presentate por favor|presentate porfa|quien sos|quien eres|quien sos vos|como te llamas|como te llamas vos|cual es tu nombre|como es tu nombre|como te llamas kira|quien es kira)$/.test(
      n,
    )
  ) {
    return true;
  }

  const bare = n
    .replace(/\b(por favor|porfa|mira|che|hola)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    /^(presentate|quiero que te presentes|podes presentarte|pode?s presentarte)$/.test(
      bare,
    )
  ) {
    return true;
  }

  // Nombre/identidad del bot, sin mezclar con ingreso / número / cliente.
  if (
    /\b(como te llamas|cual es tu nombre|como es tu nombre|quien sos|quien eres)\b/.test(n) &&
    !/\b(unidad|informe|modulo|plataforma|numero|cliente|contacto|agenda|ingreso|entrar|cargar|reconoz)\b/.test(
      n,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Acceso a Wara / cargar teléfono para que el bot reconozca al cliente.
 * Distinto de identidad del asistente.
 */
export function looksLikePlatformAccessOrPhoneRegisterQuestion(
  text: string | undefined | null,
): boolean {
  const n = normIdentityText(text);
  if (!n) return false;

  const asksAccess =
    /\b(como|donde|de que forma)\b/.test(n) &&
    /\b(ingreso|ingresar|entrar|acceso|accedo|logueo|loguearme|iniciar sesion)\b/.test(n) &&
    /\b(plataforma|wara|sistema|app|web|portal)\b/.test(n);

  const asksPhoneRegister =
    /\b(cargar|cargo|agregar|agrego|registrar|registro|anotar|dar de alta)\b/.test(n) &&
    /\b(numero|telefono|whatsapp|celular)\b/.test(n);

  const asksRecognition =
    /\b(reconoz|reconoce|reconocer|identifi)\b/.test(n) &&
    /\b(cliente|numero|telefono|whatsapp|soy)\b/.test(n);

  return asksAccess || asksPhoneRegister || asksRecognition;
}

/** Guía corta + PDF (misma guía que números no registrados). */
export function buildPlatformAccessOrPhoneRegisterReply(
  text: string | undefined | null,
): string {
  const n = normIdentityText(text);
  const wantsAccess =
    /\b(ingreso|ingresar|entrar|acceso|logueo|iniciar sesion|plataforma|app|web)\b/.test(n) &&
    !/\b(numero|telefono|whatsapp|reconoz)\b/.test(n);

  const body = wantsAccess
    ? [
        "Para *ingresar a la plataforma Wara* usá el usuario y la clave que te dio el administrador de tu cuenta (web o app).",
        "",
        "Si además querés que este WhatsApp te reconozca como contacto de la empresa:",
        "1. Entrá a *Utilidades → Opciones → Agenda*.",
        "2. Creá o editá el contacto con el teléfono de WhatsApp (con código de país).",
        "3. Asignale un perfil y guardá.",
        "",
        "Te mando la guía en PDF con el detalle.",
      ].join("\n")
    : [
        "Para que Wara *reconozca tu número* por WhatsApp tiene que estar cargado en la Agenda de la empresa:",
        "",
        "1. Entrá a *Utilidades → Opciones → Agenda*.",
        "2. Agregá o editá el contacto con ese teléfono (con código de país).",
        "3. Asignale un perfil y guardá.",
        "",
        "Si no tenés permiso de Agenda, pedile a un administrador de la cuenta que cargue tu número.",
        "",
        "Te mando la guía en PDF.",
      ].join("\n");

  return withMediaUrlMarker(body, unregisteredPhoneGuidePdfUrl());
}
