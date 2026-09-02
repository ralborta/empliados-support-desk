#!/usr/bin/env node
/**
 * Número no registrado en Wara → ticket en panel + UNA sola respuesta al cliente + PDF guía.
 * Texto canónico: aviso de derivación + mención de guía.
 * Si vuelve a escribir → sin nuevo mensaje bot (no spamear).
 *
 * Uso: npx tsx scripts/verify-unregistered-phone-handoff.mjs
 */
import assert from "node:assert/strict";
import {
  UNREGISTERED_PHONE_TICKET_TITLE,
  UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY,
  UNREGISTERED_PHONE_WAITING_ADVISOR_REPLY,
  UNREGISTERED_PHONE_GUIDE_PDF_PATH,
  ensureUnregisteredPhoneAdvisorHandoff,
  buildUnregisteredPhoneFirstHandoffMessage,
  unregisteredPhoneGuidePdfUrl,
} from "../src/lib/unregisteredPhoneHandoff.ts";
import { extractMediaUrlAndCleanText } from "../src/lib/mediaUrlMarker.ts";

assert.equal(
  typeof ensureUnregisteredPhoneAdvisorHandoff,
  "function",
  "helper de handoff exportado",
);
assert.equal(
  UNREGISTERED_PHONE_TICKET_TITLE,
  "Número no registrado en Wara",
  "título estable (no romper filtros del panel)",
);
assert.match(
  UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY,
  /No encontré empresas asociadas a tu número en Wara\. Te derivo con un agente\./,
  "aviso de derivación",
);
assert.match(
  UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY,
  /gu[ií]a.*cargar un n[uú]mero nuevo/i,
  "menciona la guía PDF",
);
assert.equal(
  UNREGISTERED_PHONE_WAITING_ADVISOR_REPLY,
  "",
  "tras la 1ª derivación no se reenvía texto",
);
assert.doesNotMatch(
  UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY,
  /Ya tenemos tu consulta|Gracias por tu paciencia/i,
  "no usar el aviso largo de calma",
);

assert.equal(
  UNREGISTERED_PHONE_GUIDE_PDF_PATH,
  "/guides/como-cargo-mi-numero-en-wara.pdf",
  "path estático del PDF",
);

const bundled = buildUnregisteredPhoneFirstHandoffMessage();
const extracted = extractMediaUrlAndCleanText(bundled);
assert.equal(extracted.text, UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY, "texto limpio sin marcador");
assert.ok(extracted.mediaUrl, "incluye mediaUrl del PDF");
assert.match(
  String(extracted.mediaUrl),
  /\/guides\/como-cargo-mi-numero-en-wara\.pdf$/,
  "mediaUrl apunta al PDF de la guía",
);
assert.match(unregisteredPhoneGuidePdfUrl(), /^https:\/\//, "URL absoluta https");

// Contrato: deferCustomerNotify no debe marcar el notice (inbound audit-only).
assert.equal(
  typeof ensureUnregisteredPhoneAdvisorHandoff,
  "function",
  "handoff acepta deferCustomerNotify en opts",
);

console.log("OK verify-unregistered-phone-handoff");
