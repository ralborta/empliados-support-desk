import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureBuilderBotContactActive } from "@/lib/builderbot";
import {
  recentLastInboundTextForPhone,
  recentThreadTextForPhone,
  shouldIgnoreDuplicateInicioTurn,
} from "@/lib/conversationThread";
import { detectLoosePlate, detectPlate, extractLastPlateFromThread, formatPlateWithSpaces, hasPendingMaintenancePlateRequest, isBarePlatePrefixHint, looksLikeBriefConfirmation, looksLikePendingTramiteAffirmation, threadAwaitingHorometerKmValue, threadAwaitingOdometerKmValue, threadHasActiveOdometerFlow, threadHasPendingUnitStatusCheckOffer, extractPlateFromUnitStatusCheckOffer, threadTextSinceCompanySelection, hasPendingOdometerConfirmation, looksLikeOdometerPendingDataAmendment, lastTomoMeterKindInThreadTail } from "@/lib/wara";
import { looksLikeRelativeDateClarificationQuestion, looksLikeRelativeDateChallenge, resolveRelativeDateChallengeReply, resolveRelativeDateClarificationReply } from "@/lib/odometroFecha";
import { getPendingAction, clearPendingAction } from "@/lib/pendingAction";
import { threadHasInconclusiveTramite } from "@/lib/tramiteFlowControl";
import { clearActiveUnit } from "@/lib/activeUnit";
import { resolvePendingConfirmationExecutor, hasAnyPendingConfirmation, buildPendingConfirmationPoliteAckReply } from "@/lib/pendingConfirmation";
import { normalizeWhatsAppPhone, isNonHumanWhatsAppSender, findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";
import { looksLikeChangeCompanyRequestHybrid } from "@/lib/whatsappAdminIntentAI";
import {
  buildCompanyMenuPayload,
  buildCompanyStatusReply,
  formatCompanyConfirmMessage,
  looksLikeChangeCompanyRequest,
  looksLikeImplicitCompanyChangeAffirmation,
  looksLikeCompanyListQuestion,
  looksLikeCompanySelection,
  looksLikeConversationAcknowledgement,
  looksLikeBareAtilioMention,
  looksLikeConversationClosing,
  looksLikeFlowControlCommand,
  looksLikeSoftFlowRestart,
  looksLikeGenericCapabilityOrTopicSwitchRequest,
  looksLikeExplicitCapabilityMenuRequest,
  looksLikeGreeting,
  looksLikeOperationalIntent,
  matchCompanyContinuationMention,
  extractExplicitCompanyMention,
  looksLikeRepeatGreetingInSession,
  buildAtilioHelpCapabilitiesReply,
  buildTicketCreationInfoReply,
  looksLikeAtilioHelpRequest,
  looksLikeServiceScopeConsultationMeta,
  looksLikeThanksOnlyAcknowledgement,
  looksLikeSubstantiveCustomerMessage,
  looksLikeTicketCreationInfoQuestion,
  resetCustomerCompanyMenu,
  resolveCustomerByWaraPhone,
  resolveCustomerForTurnContext,
  selectCompanyForCustomer,
} from "@/lib/waraApi";
import {
  buildAtilioStructuredGreeting,
  buildBriefServiceScopeConsultationReply,
  formatContinueConsult,
  formatSoftClose,
} from "@/lib/waraWhatsAppFormat";
import {
  handleCustomerConversationCloseRequest,
  looksLikeCustomerConversationCloseRequest,
} from "@/lib/customerConversationClose";
import {
  buildCaseResolutionEtaReply,
  buildOpenCaseStatusReply,
  looksLikeCaseResolutionEtaInquiry,
  looksLikeOpenCaseStatusInquiry,
  persistCustomerBotReply,
} from "@/lib/customerTicketInquiry";
/** Evita fallos por espacio final / BOM / CRLF / caracteres invisibles (Slack, Notion, Vercel). */
function normalizeSecret(s: string): string {
  let t = String(s ?? "");
  t = t.replace(/^\uFEFF/, "");
  t = t.replace(/[\u200B-\u200D\uFEFF\u2060]/g, "");
  t = t.replace(/\u00A0/g, " ");
  return t.trim().replace(/\r\n/g, "\n").trim();
}

function acceptedSecrets(): string[] {
  /**
   * Secreto compartido Empliados ↔ BuilderBot / n8n (como Pulze con x-api-key).
   * No usar BUILDERBOT_API_KEY (bb-…): eso es solo para la API de BuilderBot.cloud.
   */
  const raw = [
    process.env.PULZE_API_KEY,
    process.env.BUILDERBOT_CONTEXT_API_KEY,
    process.env.API_KEY,
    process.env.N8N_API_KEY,
  ];
  return [
    ...new Set(
      raw
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => normalizeSecret(s))
    ),
  ];
}

export function validateContextSecret(provided: string | undefined | null): boolean {
  if (provided == null || !String(provided).trim()) return false;
  const p = normalizeSecret(String(provided));
  return acceptedSecrets().some((a) => a === p);
}

/** Longitud del secreto normalizado (solo diagnóstico, sin exponer el valor). */
export function normalizedContextKeyLength(raw: string | undefined | null): number {
  if (raw == null || !String(raw).trim()) return 0;
  return normalizeSecret(String(raw)).length;
}

export function isCustomerContextAuthConfigured(): boolean {
  return acceptedSecrets().length > 0;
}

export function acceptedCustomerContextSecretCount(): number {
  return acceptedSecrets().length;
}

/** Longitudes de los secretos activos (solo números; para ver si hubo truncado vs lo enviado). */
export function acceptedContextSecretLengths(): number[] {
  return [...new Set(acceptedSecrets().map((s) => s.length))].sort((a, b) => a - b);
}

/** Nombres de env que tienen secreto (no expone valores). Para depurar 401. */
export function configuredContextSecretEnvNames(): string[] {
  const n: string[] = [];
  if (process.env.PULZE_API_KEY?.trim()) n.push("PULZE_API_KEY");
  if (process.env.BUILDERBOT_CONTEXT_API_KEY?.trim()) n.push("BUILDERBOT_CONTEXT_API_KEY");
  if (process.env.API_KEY?.trim()) n.push("API_KEY");
  if (process.env.N8N_API_KEY?.trim()) n.push("N8N_API_KEY");
  return n;
}

function decodeBasicAuthPayload(b64: string): string {
  try {
    const clean = b64.replace(/\s/g, "");
    const raw = atob(clean);
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}

/** Candidatos de clave en orden; se acepta el primero que coincida con Vercel. */
function collectContextKeyCandidates(req: NextRequest): string[] {
  const out: string[] = [];
  const push = (s: string | undefined) => {
    if (s == null || !String(s).trim()) return;
    const n = normalizeSecret(String(s));
    if (n && !out.includes(n)) out.push(n);
  };

  const tryHeader = (name: string) => {
    const v = req.headers.get(name);
    return v?.trim() ? normalizeSecret(v) : undefined;
  };

  const h =
    tryHeader("x-api-key") ??
    tryHeader("x_api_key") ??
    tryHeader("apikey") ??
    tryHeader("pulze-api-key");
  if (h) push(h);

  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const t = auth.slice(7).trim();
    if (t) push(t);
  }

  /**
   * Basic Auth: FlutterFlow / BuilderBot a veces parten un hex largo en
   * “usuario” (1 carácter) + “contraseña” (64) → solo la contraseña no matchea con Vercel (65).
   * Probamos contraseña, usuario+contraseña, y usuario.
   */
  if (auth?.toLowerCase().startsWith("basic ")) {
    const decoded = decodeBasicAuthPayload(auth.slice(6).trim());
    const colon = decoded.indexOf(":");
    if (colon >= 0) {
      const userPart = normalizeSecret(decoded.slice(0, colon));
      const passPart = normalizeSecret(decoded.slice(colon + 1));
      const combined = normalizeSecret(userPart + passPart);
      push(passPart);
      if (userPart && passPart && combined !== passPart) push(combined);
      push(userPart);
    } else if (decoded.trim()) {
      push(decoded);
    }
  }

  for (const [k, v] of req.headers.entries()) {
    if (!v?.trim()) continue;
    const low = k.toLowerCase();
    if (/api[_-]?key|x[_-]?api[_-]?key/.test(low)) {
      push(v);
    }
  }

  const { searchParams } = new URL(req.url);
  const q =
    searchParams.get("api_key") ??
    searchParams.get("apiKey") ??
    searchParams.get("key") ??
    searchParams.get("token");
  if (q?.trim()) push(q);

  return out;
}

/** Sin secretos: para ver si el cliente manda Basic vs x-api-key vs query. */
function contextAuthProbe(req: NextRequest): {
  authorizationShape: "none" | "bearer" | "basic" | "other";
  hasHeaderXApiKey: boolean;
  hasQueryApiKey: boolean;
} {
  const auth = req.headers.get("authorization");
  let authorizationShape: "none" | "bearer" | "basic" | "other" = "none";
  if (auth?.trim()) {
    const l = auth.toLowerCase();
    if (l.startsWith("bearer ")) authorizationShape = "bearer";
    else if (l.startsWith("basic ")) authorizationShape = "basic";
    else authorizationShape = "other";
  }
  const url = new URL(req.url);
  const hasQueryApiKey = !!(
    url.searchParams.get("api_key")?.trim() ||
    url.searchParams.get("apiKey")?.trim() ||
    url.searchParams.get("key")?.trim() ||
    url.searchParams.get("token")?.trim()
  );
  return {
    authorizationShape,
    hasHeaderXApiKey: !!req.headers.get("x-api-key")?.trim(),
    hasQueryApiKey,
  };
}

/** Auth para BuilderBot / n8n (misma idea que Pulze `requireApiKey`). */
export function requireBuilderBotContextAuth(req: NextRequest): NextResponse | null {
  const accepted = acceptedSecrets();
  if (accepted.length === 0) {
    return NextResponse.json(
      {
        error:
          "Definí PULZE_API_KEY o BUILDERBOT_CONTEXT_API_KEY en Vercel (un secreto largo, tipo Pulze). No uses BUILDERBOT_API_KEY (bb-…).",
        envVarsWithSecrets: configuredContextSecretEnvNames(),
      },
      { status: 503 }
    );
  }
  const candidates = collectContextKeyCandidates(req);
  if (candidates.some((c) => validateContextSecret(c))) {
    return null;
  }
  const receivedKey = candidates.length > 0;
  const longest = candidates.length
    ? candidates.reduce((a, b) => (a.length >= b.length ? a : b))
    : "";
  const providedLen = longest ? normalizedContextKeyLength(longest) : 0;
  const envNames = configuredContextSecretEnvNames();
  const multi =
    accepted.length > 1
      ? " Tenés varias claves distintas en Vercel; BuilderBot tiene que enviar exactamente el valor de UNA de ellas (carácter a carácter)."
      : "";
  const probe = contextAuthProbe(req);
  const configuredLengths = acceptedContextSecretLengths();
  const lengthMismatch = providedLen > 0 && !configuredLengths.includes(providedLen);
  const likelyPasswordTruncation =
    lengthMismatch && configuredLengths.some((l) => l === providedLen + 1);
  return NextResponse.json(
    {
      error: "API key inválida o faltante",
      receivedKey,
      acceptedSecretsCount: accepted.length,
      envVarsWithSecrets: envNames,
      providedKeyLength: providedLen,
      candidateKeyLengths: candidates.map((c) => c.length),
      configuredSecretLengths: configuredLengths,
      lengthMismatch,
      likelyPasswordFieldTruncation: likelyPasswordTruncation,
      authProbe: probe,
      hint: !receivedKey
        ? probe.authorizationShape === "basic"
          ? "Llegó Authorization: Basic sin una clave reconocible: poné el secreto de Vercel como contraseña (usuario vacío o cualquier valor), o usá header x-api-key / ?api_key= en la URL."
          : "No llegó clave usable. Como Pulze: header x-api-key = mismo texto que en Vercel. Alternativa: ?api_key=… en la URL, o POST …/api/builderbot/customer-registered/check con JSON."
        : lengthMismatch
          ? likelyPasswordTruncation
            ? `El servidor espera ${configuredLengths.join("/")} caracteres y el/los intento(s) llegan hasta ${providedLen} car. Típico: FlutterFlow limita la “contraseña” a 64; el 1er carácter a veces queda en “usuario” (ya probamos usuario+contraseña). Si sigue mal: x-api-key, ?api_key=, o secreto de 64 en Vercel (openssl rand -hex 32).`
            : `La clave que llega tiene ${providedLen} caracteres; en Vercel el secreto activo mide ${configuredLengths.join(" o ")}. Re-copiá el valor completo desde Settings → Environment.`
          : `La clave enviada no coincide (mismo largo ${providedLen} pero distinto contenido). Re-copiá BUILDERBOT_CONTEXT_API_KEY desde Vercel sin comillas.${multi}`,
    },
    { status: 401 }
  );
}

/**
 * True si el segmento de URL es un placeholder típico de BuilderBot sin sustituir
 * (llega literal en vez del número).
 */
export function isLikelyBuilderBotPhonePlaceholder(segment: string): boolean {
  const t = segment.trim();
  if (!t) return false;
  if (t.toLowerCase() === "{from}") return true;
  if (/^\{\{\s*@?from\s*\}\}$/i.test(t)) return true;
  if (/^\{\s*@?from\s*\}$/i.test(t)) return true;
  if (/^@from$/i.test(t)) return true;
  return false;
}

/**
 * Teléfono del path; si el path es placeholder y viene `?phone=` o `?from=`, usa el query.
 */
export function resolveContextPhoneFromRequest(req: NextRequest, pathSegment: string | undefined): string {
  const raw = decodeURIComponent(pathSegment ?? "").trim();
  if (isLikelyBuilderBotPhonePlaceholder(raw)) {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("phone") ?? searchParams.get("from") ?? "").trim();
    if (q) return q;
  }
  return raw;
}

/**
 * JSON tipo Pulze GET /api/bot/users/:phone/context: registered, registered_s, phone normalizado.
 */
export async function customerRegisteredContextResponse(
  rawPhone: string,
  opts?: { selectionText?: string }
): Promise<NextResponse> {
  const trimmed = rawPhone.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "Teléfono vacío" }, { status: 400 });
  }

  // Canales (newsletter), difusiones, grupos y estados NO son clientes: el bot debe
  // ignorarlos por completo (ni responder ni derivar). Evita que una noticia reenviada
  // por un canal dispare la derivación "el cliente requiere soporte".
  if (isNonHumanWhatsAppSender(trimmed)) {
    return NextResponse.json({
      registered: false,
      registered_s: "false",
      ignore: true,
      ignore_s: "true",
      nextFlow: "ignore",
      nextFlow_s: "ignore",
      phone: normalizeWhatsAppPhone(trimmed) || trimmed,
      name: "",
      companyName: "",
      validationSource: "non_human_sender",
      requiresCompanySelection: false,
      requiresCompanySelection_s: "false",
      testBlocked: false,
      testBlocked_s: "false",
    });
  }

  const normalized = normalizeWhatsAppPhone(trimmed) || trimmed.replace(/\D/g, "");

  // Takeover humano: si Atilio está pausado, NO desmutear/blacklist-remove y no responder.
  // Bug real 2026-08-20: ensureBuilderBotContactActive deshacía el "Pausar Atilio" del panel
  // en el siguiente mensaje del cliente, y la "derivación" de la comunicación no se sostenía.
  const existingCustomer = await findCustomerByWhatsAppNumber(prisma, trimmed);
  if (existingCustomer?.botPausedAt) {
    return NextResponse.json({
      registered: true,
      registered_s: "true",
      ignore: true,
      ignore_s: "true",
      nextFlow: "ignore",
      nextFlow_s: "ignore",
      phone: normalized,
      name: existingCustomer.name?.trim() || "",
      companyName: existingCustomer.companyName?.trim() || "",
      validationSource: "human_takeover_bot_paused",
      requiresCompanySelection: false,
      requiresCompanySelection_s: "false",
      botPaused: true,
      botPaused_s: "true",
      testBlocked: false,
      testBlocked_s: "false",
      message: "",
    });
  }

  // Cada mensaje humano válido debe poder hablar con el bot (evita quedar muteado 24h por un bug de flujo).
  // Solo si NO hay takeover humano activo.
  void ensureBuilderBotContactActive(normalized);

  if (normalized.length < 8) {
    const placeholderHint = isLikelyBuilderBotPhonePlaceholder(trimmed)
      ? "El path llegó como texto literal (p. ej. {from}) sin reemplazar. En BuilderBot.cloud, en la URL del HTTP usá el asistente de variables para insertar el número del contacto (remitente), no escribas {from} a mano. Alternativas: GET …/customer-registered?phone=NUMERO&api_key=… o POST …/customer-registered/check con JSON \"from\"."
      : undefined;
    return NextResponse.json(
      {
        error: "Teléfono inválido",
        received: trimmed,
        ...(placeholderHint ? { hint: placeholderHint } : {}),
      },
      { status: 400 }
    );
  }

  const selectionText = opts?.selectionText?.trim() || "";
  const earlyThreadForCompany = selectionText
    ? threadTextSinceCompanySelection(await recentThreadTextForPhone(trimmed, 24))
    : "";
  if (
    selectionText &&
    (looksLikeChangeCompanyRequest(selectionText) ||
      looksLikeImplicitCompanyChangeAffirmation(selectionText, earlyThreadForCompany) ||
      (await looksLikeChangeCompanyRequestHybrid(selectionText)))
  ) {
    const peek = await resolveCustomerByWaraPhone(prisma, trimmed);
    const peekContacts = peek.lookup?.contactos ?? [];
    const namedCompany =
      matchCompanyContinuationMention(selectionText, peekContacts) ??
      extractExplicitCompanyMention(selectionText, peekContacts);
    // "Quiero operar / cambiar al Cacique" nombra empresa: elegir de una, sin menú.
    if (namedCompany) {
      const picked = await selectCompanyForCustomer(prisma, trimmed, {
        waraContactId: namedCompany.id,
      });
      const companyName =
        picked.customer?.companyName?.trim() ||
        namedCompany.empresa?.trim() ||
        "tu empresa";
      return NextResponse.json({
        registered: peek.registered,
        registered_s: peek.registered ? "true" : "false",
        ignore: false,
        ignore_s: "false",
        phone: normalized,
        name: peek.customer?.name?.trim() || "",
        companyName,
        validationSource: peek.source,
        waraLookupConfigured: peek.lookup?.configured ?? false,
        waraContactsCount: peekContacts.length,
        waraContactId: namedCompany.id,
        waraContacts: peekContacts,
        requiresCompanySelection: false,
        requiresCompanySelection_s: "false",
        companyPickedThisTurn: true,
        companyPickedThisTurn_s: "true",
        nextFlow: "reply",
        nextFlow_s: "reply",
        selectionFailed_s: "false",
        message:
          picked.menuMessage ?? formatCompanyConfirmMessage(companyName),
        testBlocked: peek.testBlocked ?? false,
        testBlocked_s: peek.testBlocked ? "true" : "false",
      });
    }

    const reset = await resetCustomerCompanyMenu(prisma, trimmed);
    const resolution = peek;
    const customer = resolution.customer;
    return NextResponse.json({
      registered: resolution.registered,
      registered_s: resolution.registered ? "true" : "false",
      ignore: false,
      ignore_s: "false",
      phone: normalized,
      name: customer?.name?.trim() || "",
      companyName: "",
      validationSource: resolution.source,
      waraLookupConfigured: resolution.lookup?.configured ?? false,
      waraContactsCount: reset.contacts.length,
      waraContactId: reset.contacts[0]?.id ?? null,
      waraContacts: reset.contacts,
      waraContactsText: reset.waraContactsText,
      requiresCompanySelection: reset.requiresCompanySelection,
      requiresCompanySelection_s: reset.requiresCompanySelection ? "true" : "false",
      companyPickedThisTurn: false,
      companyPickedThisTurn_s: "false",
      nextFlow: "reply",
      nextFlow_s: "reply",
      selectionFailed_s: "false",
      message: reset.message,
      testBlocked: resolution.testBlocked ?? false,
      testBlocked_s: resolution.testBlocked ? "true" : "false",
    });
  }

  let resolution = await resolveCustomerForTurnContext(prisma, trimmed);
  const activeCompanyEarly =
    resolution.selectedCompanyName ?? resolution.customer?.companyName?.trim() ?? "";
  const needsCompanyPick =
    resolution.requiresCompanySelection && !activeCompanyEarly;
  let selectionMessage = "";
  let companyPickedThisTurn = false;
  const multiCompany = (resolution.lookup?.contactos.length ?? 0) > 1;
  const strictCompanyPick =
    !!selectionText && looksLikeCompanySelection(selectionText);
  if (
    strictCompanyPick &&
    (needsCompanyPick || multiCompany)
  ) {
    const previousContactId = resolution.customer?.selectedCompanyContactId ?? null;
    const picked = await selectCompanyForCustomer(prisma, trimmed, {
      companyName: selectionText,
    });
    if (picked.ok) {
      companyPickedThisTurn = true;
      resolution = await resolveCustomerByWaraPhone(prisma, trimmed);
      const pickedCompany = picked.customer?.companyName?.trim() || "";
      const sameCompany =
        previousContactId != null && picked.matchedContact?.id === previousContactId;
      selectionMessage =
        picked.menuMessage ??
        (sameCompany
          ? `Estás operando con ${pickedCompany}. ¿En qué te puedo ayudar?`
          : pickedCompany
            ? formatCompanyConfirmMessage(pickedCompany)
            : "Perfecto. ¿En qué te puedo ayudar?");
    } else {
      selectionMessage = picked.menuMessage ?? picked.error ?? "";
    }
  }

  const customer = resolution.customer;
  const registered = resolution.registered;
  const lastTicket = customer
    ? await prisma.ticket.findFirst({
        where: {
          customerId: customer.id,
          NOT: {
            AND: [
              { title: { in: ["Otro", "Consulta/reclamo"] } },
              { aiSummary: { contains: "matrícula sin informar" } },
            ],
          },
        },
        orderBy: { updatedAt: "desc" },
        select: {
          code: true,
          status: true,
          category: true,
          priority: true,
          title: true,
          aiSummary: true,
          updatedAt: true,
        },
      })
    : null;
  const contacts = resolution.lookup?.contactos ?? [];
  const requiresCompanySelection = resolution.requiresCompanySelection;
  const activeCompany =
    resolution.selectedCompanyName ?? customer?.companyName?.trim() ?? "";
  /** Solo pedir menú si falta elegir; si ya hay empresa guardada, seguir el trámite. */
  const needsCompanyMenu = requiresCompanySelection && !activeCompany;
  /**
   * "Quiero continuar con el cacique" / "sigamos con Wara": confirmación (o cambio) de
   * empresa que NO califica como `looksLikeCompanySelection` (el "quiero" activa
   * `looksLikeOperationalIntent`, que la descarta a propósito). Sin esto, caía al router
   * genérico → ejecutor de unidades por defecto → el respaldo de "unidad activa" repetía
   * el último reporte de GPS ya mostrado (bug real, producción 2026-07-23).
   */
  const matchedCompanyMention =
    selectionText && contacts.length > 0
      ? matchCompanyContinuationMention(selectionText, contacts)
      : null;
  /**
   * Declaración explícita de empresa ("la empresa es el cacique, la unidad es la
   * AF061DO"): a diferencia de `matchedCompanyMention`, tolera contenido operativo extra
   * en el mismo mensaje. Solo se usa cuando TODAVÍA falta elegir empresa (needsCompanyMenu
   * se calcula debajo, así que se recalcula la misma condición acá) para no interferir con
   * mensajes operativos normales de un cliente que ya tiene empresa resuelta.
   */
  const explicitCompanyMentionWhilePending =
    requiresCompanySelection && !activeCompany && selectionText && contacts.length > 0
      ? extractExplicitCompanyMention(selectionText, contacts)
      : null;
  const menuPayload = contacts.length
    ? await buildCompanyMenuPayload(contacts, normalized)
    : null;
  const waraContactsText = menuPayload?.waraContactsText ?? "";
  const lastTicketSummary = lastTicket?.aiSummary?.trim() || "";
  const lastTicketTitle = lastTicket?.title?.trim() || "";
  const lastTicketContextText = lastTicket
    ? `Último ticket: ${lastTicket.code} (${lastTicket.status})` +
      `${lastTicketTitle ? ` - ${lastTicketTitle}` : ""}` +
      `${lastTicketSummary ? `. Resumen: ${lastTicketSummary}` : ""}`
    : "";

  const fullThreadText = customer ? await recentThreadTextForPhone(trimmed) : "";
  const scopedThreadText = threadTextSinceCompanySelection(fullThreadText);
  const lastKnownPlate = extractLastPlateFromThread(scopedThreadText) ?? "";
  const lastKnownPlateFormatted = lastKnownPlate
    ? formatPlateWithSpaces(lastKnownPlate) ?? lastKnownPlate
    : "";
  const hasKnownPlate = !!lastKnownPlate;
  const threadOperationalHint = hasKnownPlate
    ? `Patente/matrícula ya mencionada en este hilo: ${lastKnownPlateFormatted}. No la vuelvas a pedir salvo corrección explícita del cliente.`
    : "";

  let responseMessage = selectionMessage;
  const threadForMaintIntent = scopedThreadText || fullThreadText;
  if (
    !responseMessage &&
    registered &&
    contacts.length > 1 &&
    selectionText &&
    looksLikeCompanyListQuestion(selectionText)
  ) {
    responseMessage = buildCompanyStatusReply(activeCompany, contacts.length, waraContactsText);
  } else if (!responseMessage && needsCompanyMenu && waraContactsText && !matchedCompanyMention && !explicitCompanyMentionWhilePending) {
    responseMessage =
      `Veo que este número está asociado a más de una empresa en Wara. ¿De cuál escribís?\n\n` +
      `${waraContactsText}\n\n` +
      `Respondé con el número de la opción o con el nombre de la empresa.`;
  }
  // Ruteo explícito para BuilderBot: evita saltar al Router en saludos (ahí se perdía la respuesta).
  type NextFlow = "ignore" | "elegir" | "derivar" | "reply" | "router";
  let nextFlow: NextFlow = "derivar";
  const duplicateInicioTurn =
    !!selectionText &&
    (await shouldIgnoreDuplicateInicioTurn(trimmed, selectionText));
  if (resolution.testBlocked) {
    // Whitelist de prueba: no abrir ticket ni contestar a números fuera de lista.
    nextFlow = "ignore";
    responseMessage = "";
  } else if (!registered) {
    // Número no en Wara → ticket + asesor en el panel (no solo el mensaje BBC).
    try {
      const {
        ensureUnregisteredPhoneAdvisorHandoff,
        UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY,
        UNREGISTERED_PHONE_WAITING_ADVISOR_REPLY,
      } = await import("@/lib/unregisteredPhoneHandoff");
      const handoff = await ensureUnregisteredPhoneAdvisorHandoff(prisma, trimmed, {
        contactName: customer?.name ?? undefined,
        messageText: selectionText || undefined,
        source: "builderbot_context",
      });
      if (handoff.shouldNotifyCustomer) {
        nextFlow = "reply";
        responseMessage = UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY;
        await persistCustomerBotReply(trimmed, responseMessage, {
          source: "builderbot_context",
          stage: "unregistered_first_handoff",
        });
      } else {
        // Ya derivado: calma (Atilio NO se pausa; no repetir el aviso largo).
        nextFlow = "reply";
        responseMessage = UNREGISTERED_PHONE_WAITING_ADVISOR_REPLY;
        await persistCustomerBotReply(trimmed, responseMessage, {
          source: "builderbot_context",
          stage: "unregistered_waiting_advisor",
        });
      }
    } catch (e) {
      console.error("[builderbotCustomerContext] unregistered handoff:", e);
      nextFlow = "reply";
      responseMessage =
        "No encontramos este número registrado en Wara. Derivamos tu consulta a un asesor de Atención al Cliente; te van a escribir por este medio a la brevedad.";
    }
  } else if (
    selectionText &&
    looksLikeCustomerConversationCloseRequest(selectionText)
  ) {
    const closeResult = await handleCustomerConversationCloseRequest({
      rawPhone: trimmed,
      messageText: selectionText,
      source: "builderbot_context",
    });
    nextFlow = "reply";
    responseMessage = closeResult.replyMessage;
  } else if (selectionText && looksLikeOpenCaseStatusInquiry(selectionText)) {
    responseMessage = await buildOpenCaseStatusReply(trimmed);
    await persistCustomerBotReply(trimmed, responseMessage, {
      source: "builderbot_context",
      stage: "open_case_status_inquiry",
    });
    nextFlow = "reply";
  } else if (selectionText && looksLikeCaseResolutionEtaInquiry(selectionText)) {
    responseMessage = await buildCaseResolutionEtaReply(trimmed);
    await persistCustomerBotReply(trimmed, responseMessage, {
      source: "builderbot_context",
      stage: "case_resolution_eta_inquiry",
    });
    nextFlow = "reply";
  } else if (
    selectionText &&
    !looksLikeAtilioHelpRequest(selectionText) &&
    looksLikeBareAtilioMention(selectionText)
  ) {
    // Bug real, producción 2026-07-28 (3ra vuelta): tras ya haber mandado el párrafo
    // completo de capacidades, el cliente escribió solo "Atilio" de nuevo y el bot
    // repetía TEXTUALMENTE el mismo párrafo largo. Pedido explícito: "cuando se le diga
    // Atilio... mejor pregunta cómo puede ayudar después de un Hola XXX" — respuesta
    // corta, no la lista completa de capacidades otra vez.
    responseMessage = buildAtilioStructuredGreeting({
      threadText: scopedThreadText || fullThreadText,
      companyName: activeCompany,
      repeatGreeting: true,
    });
    await persistCustomerBotReply(trimmed, responseMessage, {
      source: "builderbot_context",
      stage: "atilio_bare_name_mention",
    });
    nextFlow = "reply";
  } else if (selectionText && looksLikeTicketCreationInfoQuestion(selectionText)) {
    await clearActiveUnit(prisma, trimmed);
    responseMessage = buildTicketCreationInfoReply();
    await persistCustomerBotReply(trimmed, responseMessage, {
      source: "builderbot_context",
      stage: "ticket_creation_info",
    });
    nextFlow = "reply";
  } else if (
    selectionText &&
    looksLikeServiceScopeConsultationMeta(selectionText) &&
    !(
      hasAnyPendingConfirmation(scopedThreadText || fullThreadText) ||
      (await getPendingAction(prisma, trimmed))?.payload
    )
  ) {
    responseMessage = buildBriefServiceScopeConsultationReply();
    await persistCustomerBotReply(trimmed, responseMessage, {
      source: "builderbot_context",
      stage: "service_scope_consultation_meta",
    });
    nextFlow = "reply";
  } else if (
    selectionText &&
    looksLikeExplicitCapabilityMenuRequest(selectionText)
  ) {
    // Menú fijo de capacidades — gana sobre tema anterior; no cancela trámite en DB.
    const firstName = customer?.name?.trim().split(/\s+/)[0];
    responseMessage = buildAtilioHelpCapabilitiesReply(firstName, activeCompany);
    await persistCustomerBotReply(trimmed, responseMessage, {
      source: "builderbot_context",
      stage: "atilio_help_capabilities",
    });
    nextFlow = "reply";
  } else if (
    selectionText &&
    (looksLikeAtilioHelpRequest(selectionText) ||
      looksLikeGenericCapabilityOrTopicSwitchRequest(selectionText))
  ) {
    // Topic-switch / "otra consulta" / ayuda genérica → IA, no panfleto.
    nextFlow = "router";
    responseMessage = "";
  } else if (selectionText && looksLikeFlowControlCommand(selectionText)) {
    const pendingNow =
      hasAnyPendingConfirmation(scopedThreadText || fullThreadText) ||
      !!(await getPendingAction(prisma, trimmed))?.payload;
    if (pendingNow) {
      nextFlow = "router";
      responseMessage = "";
    } else {
      await clearActiveUnit(prisma, trimmed);
      nextFlow = "reply";
      responseMessage = formatContinueConsult({ companyName: activeCompany || null });
      await persistCustomerBotReply(trimmed, responseMessage, {
        source: "builderbot_context",
        stage: "flow_reset",
      });
    }
  } else if (!selectionText.trim()) {
    // Cuerpo vacío (re-ejecución BBC sin {body}): no repetir saludo; reintentar trámite o ignorar.
    const lastInbound = await recentLastInboundTextForPhone(trimmed);
    if (lastInbound && looksLikeOperationalIntent(lastInbound)) {
      if (await shouldIgnoreDuplicateInicioTurn(trimmed, lastInbound)) {
        nextFlow = "ignore";
        responseMessage = "";
      } else {
        nextFlow = "router";
        responseMessage = "";
      }
    } else if (lastInbound && (await shouldIgnoreDuplicateInicioTurn(trimmed, lastInbound))) {
      nextFlow = "ignore";
      responseMessage = "";
    } else {
      nextFlow = "reply";
      if (!responseMessage) {
        responseMessage = buildAtilioStructuredGreeting({
          threadText: scopedThreadText || fullThreadText,
          companyName: activeCompany,
        });
      }
    }
  } else if (looksLikeGreeting(selectionText) || looksLikeSoftFlowRestart(selectionText)) {
    const threadForGreeting = scopedThreadText || fullThreadText;
    const pendingActionRecord = await getPendingAction(prisma, trimmed);
    if (
      await shouldIgnoreDuplicateInicioTurn(trimmed, selectionText)
    ) {
      nextFlow = "ignore";
      responseMessage = "";
    } else {
    const forceRestart = looksLikeSoftFlowRestart(selectionText);
    const inconclusive =
      forceRestart || threadHasInconclusiveTramite(threadForGreeting, pendingActionRecord);
    // Saludo = arrancar de cero aunque haya trámite inconcluso (bug prod 2026-08-17).
    if (inconclusive) {
      await clearPendingAction(prisma, trimmed);
      await clearActiveUnit(prisma, trimmed);
    }
    nextFlow = "reply";
    if (!responseMessage) {
      const repeatGreeting =
        inconclusive ||
        looksLikeRepeatGreetingInSession(threadForGreeting, selectionText) ||
        !!(lastTicket && (lastKnownPlate || lastTicket.code));
      const greetingThread = inconclusive ? "" : threadForGreeting;
      const greetingPending = inconclusive ? null : pendingActionRecord;
      if (repeatGreeting && multiCompany && waraContactsText && !inconclusive) {
        responseMessage = buildAtilioStructuredGreeting({
          threadText: greetingThread,
          companyListBlock: waraContactsText,
          pendingAction: greetingPending,
        });
      } else {
        responseMessage = buildAtilioStructuredGreeting({
          threadText: greetingThread,
          companyName: activeCompany,
          repeatGreeting: inconclusive ? false : repeatGreeting,
          pendingAction: greetingPending,
        });
      }
    }
    }
  } else if (selectionText && looksLikeConversationClosing(selectionText)) {
    const pendingNow =
      hasAnyPendingConfirmation(scopedThreadText || fullThreadText) ||
      !!(await getPendingAction(prisma, trimmed))?.payload;
    if (pendingNow) {
      nextFlow = "router";
      responseMessage = "";
    } else {
    // Despedida real ("adiós", "nada más gracias", "no gracias", "hasta luego"): cerrar
    // la charla con calidez, SIN pregunta de seguimiento (evita el loop de "¿necesitás
    // algo más?" repetido) y SIN caer al router (que reabría el último trámite operativo
    // y repetía un reporte viejo — bug real, producción 2026-07-23).
    nextFlow = "reply";
    if (!responseMessage) {
      const firstName = customer?.name?.trim().split(/\s+/)[0];
      responseMessage = firstName
        ? `${formatSoftClose("bye")} ${firstName}.`
        : formatSoftClose("bye");
    }
    }
  } else if (
    selectionText &&
    looksLikePendingTramiteAffirmation(selectionText) &&
    threadHasPendingUnitStatusCheckOffer(scopedThreadText || fullThreadText)
  ) {
    // "Si" confirmando "¿querés que revise el estado de AD 578 WX?" — continuar consulta,
    // no resetear empresa ni cerrar con "De nada".
    nextFlow = "router";
    responseMessage = "";
  } else if (
    selectionText &&
    looksLikePendingTramiteAffirmation(selectionText) &&
    (resolvePendingConfirmationExecutor(scopedThreadText || fullThreadText, selectionText) ||
      (await getPendingAction(prisma, trimmed))?.payload)
  ) {
    // "Perfecto", "listo", "dale" con confirmación pendiente → ejecutor operativo, no cierre social.
    nextFlow = "router";
    responseMessage = "";
  } else if (
    selectionText &&
    lastTicket &&
    (lastTicket.status === "RESOLVED" || lastTicket.status === "CLOSED") &&
    (looksLikeConversationAcknowledgement(selectionText) ||
      looksLikeConversationClosing(selectionText))
  ) {
    // Tras resolver/cerrar el ticket, un "gracias" o despedida no debe reabrir trámites
    // ni preguntar "¿necesitás algo más?" (bug real, producción 2026-07-24).
    nextFlow = "reply";
    const firstName = customer?.name?.trim().split(/\s+/)[0];
    responseMessage = firstName
      ? `¡Listo, ${firstName}! Que tengas buen día. Cualquier cosa, escribime por este medio.`
      : "¡Listo! Que tengas buen día. Cualquier cosa, escribime por este medio.";
    await persistCustomerBotReply(trimmed, responseMessage, {
      source: "builderbot_context",
      stage: "post_resolved_farewell",
    });
  } else if (
    selectionText &&
    looksLikeConversationAcknowledgement(selectionText) &&
    hasAnyPendingConfirmation(scopedThreadText || fullThreadText)
  ) {
    // Con pending: "gracias" → polite reminder; "ok/listo" ya fue al router arriba si es affirmation.
    nextFlow = "reply";
    const firstName = customer?.name?.trim().split(/\s+/)[0];
    responseMessage = buildPendingConfirmationPoliteAckReply(
      scopedThreadText || fullThreadText,
      firstName,
    );
    await persistCustomerBotReply(trimmed, responseMessage, {
      source: "builderbot_context",
      stage: "pending_confirm_polite_ack",
    });
  } else if (selectionText && looksLikeThanksOnlyAcknowledgement(selectionText)) {
    // Solo "gracias" cierra social. "ok/listo/perfecto" van a la IA.
    nextFlow = "reply";
    if (!responseMessage) {
      const firstName = customer?.name?.trim().split(/\s+/)[0];
      responseMessage = firstName
        ? `De nada, ${firstName}. ¿Necesitás algo más?`
        : "De nada. ¿En qué más te ayudo?";
    }
  } else if (companyPickedThisTurn) {
    nextFlow = "reply";
    if (!responseMessage) {
      responseMessage = formatCompanyConfirmMessage(activeCompany || "tu empresa");
    }
  } else if (
    selectionText &&
    looksLikeCompanyListQuestion(selectionText)
  ) {
    // Bug real, producción 2026-07-28: esta rama solo ponía nextFlow="reply" confiando en
    // que el pre-check de arriba (línea ~512, que exige `contacts.length > 1`) ya hubiese
    // completado `responseMessage`. Si el lookup de Wara devolvía 0 o 1 contacto en este
    // turno (intermitencia, o porque ya había una sola empresa resuelta), esa condición no
    // se cumplía y responseMessage quedaba vacío — el cliente preguntaba "en qué empresa
    // estoy operando" y el bot terminaba respondiendo el genérico "¿En qué te puedo
    // ayudar?", ignorando la pregunta. Esta rama ahora arma su propia respuesta con
    // buildCompanyStatusReply (lo que ya sabemos: activeCompany / waraContactsText), sin
    // depender de esa otra condición.
    nextFlow = "reply";
    if (!responseMessage) {
      responseMessage = buildCompanyStatusReply(activeCompany, contacts.length, waraContactsText);
    }
  } else if (
    selectionText &&
    (looksLikeRelativeDateClarificationQuestion(selectionText) ||
      looksLikeRelativeDateChallenge(selectionText))
  ) {
    const pending = await getPendingAction(prisma, trimmed);
    const threadForFlow = scopedThreadText || fullThreadText;
    const inOdometerFlow =
      pending?.type === "odometro" || threadHasActiveOdometerFlow(threadForFlow);
    // Corrección de fecha/hora durante trámite medidor → executor (rearmar resumen), no aclaración suelta.
    if (inOdometerFlow && looksLikeOdometerPendingDataAmendment(selectionText)) {
      nextFlow = "router";
      responseMessage = "";
    } else {
      nextFlow = "reply";
      const dateReply =
        resolveRelativeDateClarificationReply(selectionText) ??
        resolveRelativeDateChallengeReply(selectionText);
      if (dateReply && !responseMessage) {
        const meterKind =
          pending?.payload?.meterType === "horometro" ||
          threadAwaitingHorometerKmValue(threadForFlow) ||
          lastTomoMeterKindInThreadTail(threadForFlow) === "horometro"
            ? "horómetro"
            : "odómetro";
        responseMessage = inOdometerFlow
          ? `${dateReply} Si veníamos con un cambio de ${meterKind}, decime CONFIRMO cuando quieras registrarlo.`
          : dateReply;
      }
    }
  } else if (explicitCompanyMentionWhilePending || matchedCompanyMention) {
    // "la empresa es el cacique…" o "quiero operar con la empresa El Cacique":
    // elegir empresa ANTES del router operativo ("quiero" no es un trámite).
    const chosen = explicitCompanyMentionWhilePending ?? matchedCompanyMention;
    nextFlow = "reply";
    const picked = await selectCompanyForCustomer(prisma, trimmed, {
      waraContactId: chosen!.id,
    });
    responseMessage =
      picked.menuMessage ??
      formatCompanyConfirmMessage(
        picked.customer?.companyName?.trim() || activeCompany || "tu empresa",
      );
  } else if (needsCompanyMenu) {
    // Bug real 2026-08-23: con menú de empresa pendiente, el trámite operativo
    // (Horometro 900133) iba igual al router → 1) menú empresa + 2) "no identifiqué
    // la unidad" en el mismo segundo. Sin empresa no hay flota confiable: parar acá.
    nextFlow = "reply";
    if (!responseMessage && waraContactsText) {
      responseMessage =
        `Veo que este número está asociado a más de una empresa en Wara. ¿De cuál escribís?\n\n` +
        `${waraContactsText}\n\n` +
        `Respondé con el número de la opción o con el nombre de la empresa.`;
    } else if (!responseMessage && selectionText && looksLikeCompanySelection(selectionText)) {
      responseMessage =
        `No pude registrar esa opción. ¿De cuál empresa escribís?\n\n${waraContactsText}\n\n` +
        `Respondé con el número de la opción o con el nombre de la empresa.`;
    }
  } else if (selectionText && looksLikeOperationalIntent(selectionText)) {
    // Ya hay empresa (o no hace falta menú): trámites operativos al router.
    nextFlow = "router";
    responseMessage = "";
  } else if (strictCompanyPick && multiCompany && selectionMessage) {
    nextFlow = "reply";
  } else if (
    duplicateInicioTurn &&
    selectionText &&
    !isBarePlatePrefixHint(selectionText) &&
    !detectLoosePlate(selectionText) &&
    !hasPendingMaintenancePlateRequest(threadForMaintIntent)
  ) {
    nextFlow = "ignore";
    responseMessage = "";
  } else if (registered && selectionText.trim()) {
    // Fase 1 completa: /turn clasifica y ejecuta (operativo + guías + derivación).
    nextFlow = "router";
    responseMessage = "";
  } else {
    nextFlow = "reply";
  }

  if (nextFlow === "reply" && !responseMessage.trim()) {
    responseMessage = "¿En qué te puedo ayudar?";
  }

  return NextResponse.json({
    registered,
    registered_s: registered ? "true" : "false",
    ignore: false,
    ignore_s: "false",
    phone: normalized,
    name: customer?.name?.trim() || "",
    companyName: resolution.selectedCompanyName ?? customer?.companyName?.trim() ?? "",
    validationSource: resolution.source,
    waraLookupConfigured: resolution.lookup?.configured ?? false,
    waraContactsCount: contacts.length,
    waraContactId: contacts[0]?.id ?? null,
    waraContacts: contacts,
    waraContactsText,
    lastTicketCode: lastTicket?.code ?? "",
    lastTicketStatus: lastTicket?.status ?? "",
    lastTicketCategory: lastTicket?.category ?? "",
    lastTicketPriority: lastTicket?.priority ?? "",
    lastTicketTitle,
    lastTicketSummary,
    lastTicketUpdatedAt: lastTicket?.updatedAt?.toISOString() ?? "",
    hasLastTicket: !!lastTicket,
    hasLastTicket_s: lastTicket ? "true" : "false",
    lastTicketContextText,
    lastKnownPlate,
    lastKnownPlateFormatted,
    hasKnownPlate,
    hasKnownPlate_s: hasKnownPlate ? "true" : "false",
    threadOperationalHint,
    requiresCompanySelection: needsCompanyMenu,
    requiresCompanySelection_s: needsCompanyMenu ? "true" : "false",
    companyPickedThisTurn,
    companyPickedThisTurn_s: companyPickedThisTurn ? "true" : "false",
    nextFlow,
    nextFlow_s: nextFlow,
    // No usar selectionFailed_s para rutear a mute/silencio: solo requiresCompanySelection + message.
    selectionFailed_s: "false",
    message: responseMessage,
    testBlocked: resolution.testBlocked ?? false,
    testBlocked_s: resolution.testBlocked ? "true" : "false",
  });
}
