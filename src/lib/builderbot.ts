import axios from 'axios';

const UNREGISTERED_GUIDE_WHATSAPP_FILE_NAME =
  "Como cargo mi numero en la plataforma Wara.pdf";

function fileNameForWhatsAppMediaUrl(mediaUrl: string | undefined): string | undefined {
  if (!mediaUrl) return undefined;
  if (
    /como-cargo-mi-numero-en-wara/i.test(mediaUrl) ||
    /Como cargo mi numero en la plataforma Wara/i.test(mediaUrl)
  ) {
    return UNREGISTERED_GUIDE_WHATSAPP_FILE_NAME;
  }
  return undefined;
}

type AxiosPost = typeof axios.post;
let httpPost: AxiosPost = axios.post.bind(axios);

/** Solo scripts de verificación: evita HTTP real y valida comportamiento del sender. */
export function setBuilderBotHttpPostForTests(post: AxiosPost | null): void {
  httpPost = post ?? axios.post.bind(axios);
}

const BUILDERBOT_BASE_URL =
  process.env.BUILDERBOT_BASE_URL || 'https://app.builderbot.cloud';

export interface SendWhatsAppOptions {
  number: string; // número en formato internacional (ej: 5491112345678)
  message: string; // contenido del mensaje
  mediaUrl?: string; // opcional
  /** Nombre del documento en WhatsApp (PDF). Evita el sufijo numérico del CDN. */
  fileName?: string;
  checkIfExists?: boolean; // default false
}

/**
 * Envía un mensaje de WhatsApp vía BuilderBot Cloud (API v2).
 *
 * Idempotencia externa: BuilderBot v2 `/messages` no expone clave de idempotencia
 * por request (solo `checkIfExists`, no reenvío seguro). Política WARA ante POST
 * ambiguo (timeout/red sin body): priorizar evitar duplicados — no reenviar si el
 * ledger inbound ya tiene `waOutboundProviderId`; devolver `delivery_persist_failed`
 * sin BBC fallback. Ver `ensureInboundWaProviderIdStashed` y turnWhatsAppDeliveryLedger.
 */
export async function sendWhatsAppMessage(options: SendWhatsAppOptions) {
  const { message, mediaUrl, checkIfExists = false } = options;
  const fileName =
    String(options.fileName ?? "").trim() || fileNameForWhatsAppMediaUrl(mediaUrl);
  const number = String(options.number ?? "").replace(/\D/g, "");
  if (number.length < 8) {
    throw new Error("Número de WhatsApp inválido");
  }

  const BOT_ID = process.env.BUILDERBOT_BOT_ID || '';
  const API_KEY = process.env.BUILDERBOT_API_KEY || '';

  if (!BOT_ID || !API_KEY) {
    throw new Error(
      'BuilderBot no configurado: define BUILDERBOT_BOT_ID y BUILDERBOT_API_KEY'
    );
  }

  const url = `${BUILDERBOT_BASE_URL}/api/v2/${BOT_ID}/messages`;

  const body: Record<string, unknown> = {
    messages: {
      content: message,
      ...(mediaUrl ? { mediaUrl } : {}),
      ...(mediaUrl && fileName ? { fileName, filename: fileName } : {}),
    },
    number,
    checkIfExists,
  };

  // Serializar a Buffer UTF-8 explícito: evita mojibake (Ã©/Ã³) si algún
  // intermediario interpreta el body JSON como Latin-1.
  const payload = Buffer.from(JSON.stringify(body), "utf8");

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "x-api-builderbot": API_KEY,
    "Content-Length": String(payload.length),
  };

  console.log('[BuilderBot] Enviando mensaje:', {
    url,
    number,
    messageLength: message.length,
    hasMediaUrl: !!mediaUrl,
  });

  try {
    const response = await httpPost(url, payload, {
      headers,
      timeout: 30000,
      transformRequest: [(data) => data],
    });
    console.log('[BuilderBot] ✅ Mensaje enviado exitosamente');
    return response.data;
  } catch (error: any) {
    console.error('[BuilderBot] ❌ Error al enviar mensaje:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });
    throw new Error(
      `Error al enviar mensaje a BuilderBot: ${error.message}`
    );
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BLACKLIST_RETRIES = 3;
const BLACKLIST_DELAY_MS = 1500;
const BLACKLIST_SETTLE_MS = 800;

export type BuilderBotChannelReconcile = {
  muteOk: boolean;
  blacklistOk: boolean;
  ok: boolean;
};

/**
 * Desmutear / mutear un contacto en BuilderBot Cloud (plugin add_mute del runtime).
 * POST /api/v2/{botId}/mute con { number, status: boolean }.
 * Distinto de /blacklist: hay que tocar las dos APIs para dejar el canal usable.
 */
export async function setBuilderBotContactMute(
  number: string,
  muted: boolean
): Promise<boolean> {
  const BOT_ID = process.env.BUILDERBOT_BOT_ID || "";
  const API_KEY = process.env.BUILDERBOT_API_KEY || "";
  if (!BOT_ID || !API_KEY) return true;

  const normalizedNumber = String(number).replace(/\D/g, "");
  if (normalizedNumber.length < 9) return false;

  const url = `${BUILDERBOT_BASE_URL.replace(/\/$/, "")}/api/v2/${BOT_ID}/mute`;
  try {
    const response = await axios.post(
      url,
      { number: normalizedNumber, status: muted },
      {
        headers: { "Content-Type": "application/json", "x-api-builderbot": API_KEY },
        timeout: 15000,
      }
    );
    console.log("[BuilderBot] Cloud mute OK", muted, normalizedNumber, response.data);
    return true;
  } catch (error: unknown) {
    const err = error as { response?: { status?: number; data?: unknown }; message?: string };
    console.error("[BuilderBot] Cloud mute falló", muted, normalizedNumber, {
      status: err.response?.status,
      data: err.response?.data,
      message: err?.message,
    });
    return false;
  }
}

/**
 * Deja el contacto hablable en Cloud: mute=false + blacklist=remove.
 * Espera ambas operaciones y reporta si alguna falló.
 */
export async function ensureBuilderBotContactActive(
  number: string
): Promise<BuilderBotChannelReconcile> {
  const muteOk = await setBuilderBotContactMute(number, false);
  const blacklistOk = await setBuilderBotCloudBlacklist(number, "remove");
  const ok = muteOk && blacklistOk;
  if (!ok) {
    console.error("[BuilderBot] Reconciliación mute/blacklist incompleta", {
      muteOk,
      blacklistOk,
    });
  }
  return { muteOk, blacklistOk, ok };
}

/**
 * Pausa o reactiva el flujo del bot para un número vía BuilderBot Cloud API v2.
 * POST /api/v2/{botId}/blacklist con { number, intent: "add" | "remove" }.
 */
export async function setBuilderBotCloudBlacklist(
  number: string,
  intent: "add" | "remove"
): Promise<boolean> {
  const BOT_ID = process.env.BUILDERBOT_BOT_ID || "";
  const API_KEY = process.env.BUILDERBOT_API_KEY || "";
  if (!BOT_ID || !API_KEY) return true;

  const normalizedNumber = String(number).replace(/\D/g, "");
  if (normalizedNumber.length < 9) return false;

  const url = `${BUILDERBOT_BASE_URL.replace(/\/$/, "")}/api/v2/${BOT_ID}/blacklist`;
  const headers = {
    "Content-Type": "application/json",
    "x-api-builderbot": API_KEY,
  };
  const body = { number: normalizedNumber, intent };

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= BLACKLIST_RETRIES; attempt++) {
    try {
      const response = await axios.post(url, body, { headers, timeout: 15000 });
      console.log("[BuilderBot] Cloud blacklist OK", intent, normalizedNumber, response.data);
      await sleep(BLACKLIST_SETTLE_MS);
      return true;
    } catch (error: unknown) {
      lastError = error;
      const err = error as { response?: { status?: number; data?: unknown }; message?: string };
      console.error(
        `[BuilderBot] Cloud blacklist attempt ${attempt}/${BLACKLIST_RETRIES}`,
        intent,
        normalizedNumber,
        { status: err.response?.status, data: err.response?.data, message: err?.message }
      );
      if (attempt < BLACKLIST_RETRIES) {
        await sleep(BLACKLIST_DELAY_MS);
      }
    }
  }
  console.error(
    "[BuilderBot] Cloud blacklist falló tras reintentos",
    intent,
    normalizedNumber,
    (lastError as { response?: { data?: unknown } })?.response?.data ?? lastError
  );
  return false;
}

const BUILDERBOT_BOT_URL = process.env.BUILDERBOT_BOT_URL || "";
const BUILDERBOT_DASHBOARD_TOKEN = process.env.BUILDERBOT_DASHBOARD_TOKEN || "";

/** Blacklist opcional del bot self-hosted (BUILDERBOT_BOT_URL). */
export async function setBotBlacklist(number: string, intent: "add" | "remove"): Promise<void> {
  if (!BUILDERBOT_BOT_URL) return;

  const normalizedNumber = String(number).replace(/\D/g, "");
  if (normalizedNumber.length < 9) return;

  const url = `${BUILDERBOT_BOT_URL.replace(/\/$/, "")}/v1/blacklist`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (BUILDERBOT_DASHBOARD_TOKEN) {
    headers.Authorization = `Bearer ${BUILDERBOT_DASHBOARD_TOKEN}`;
  }

  try {
    const response = await axios.post(url, { number: normalizedNumber, intent }, { headers, timeout: 10000 });
    console.log("[BuilderBot] Blacklist self-hosted", intent, normalizedNumber, response.data);
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error("[BuilderBot] Error blacklist self-hosted", intent, err?.message);
  }
}
