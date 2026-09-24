#!/usr/bin/env node
/**
 * Número no registrado en Wara → ticket en panel + respuesta al cliente + PDF guía.
 * 1ª vez: derivación + guía.
 * Recontacto (aunque sea meses después): SIEMPRE contesta — ticket ya abierto + no registrado + PDF.
 *
 * Uso: npx tsx scripts/verify-unregistered-phone-handoff.mjs
 */
import assert from "node:assert/strict";
import {
  UNREGISTERED_PHONE_TICKET_TITLE,
  UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY,
  UNREGISTERED_PHONE_WAITING_ADVISOR_REPLY,
  UNREGISTERED_PHONE_RECHECK_AFTER_LOAD_REPLY,
  UNREGISTERED_PHONE_GUIDE_PDF_PATH,
  ensureUnregisteredPhoneAdvisorHandoff,
  buildUnregisteredPhoneFirstHandoffMessage,
  buildUnregisteredPhoneWaitingAdvisorReply,
  buildUnregisteredPhoneWaitingHandoffMessage,
  buildUnregisteredPhoneCustomerReply,
  looksLikeJustRegisteredPhoneInWara,
  unregisteredPhoneGuidePdfUrl,
} from "../src/lib/unregisteredPhoneHandoff.ts";
import { waraPhoneLookupCandidates } from "../src/lib/whatsappPhone.ts";
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
assert.match(
  UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY,
  /Te env[ií]o también/i,
  "copy: Te envío (no 'Te mando')",
);
assert.doesNotMatch(
  UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY,
  /Te mando/i,
  "no usar 'Te mando'",
);

const waiting = buildUnregisteredPhoneWaitingAdvisorReply("0209266");
assert.match(waiting, /no está registrado/i, "recontacto: no registrado");
assert.doesNotMatch(waiting, /0209266|ticket\s+\d+/i, "recontacto: NO entregar número de ticket");
assert.match(waiting, /gu[ií]a/i, "recontacto: menciona guía");
assert.match(waiting, /Te env[ií]o la gu[ií]a/i, "recontacto: Te envío");
assert.match(UNREGISTERED_PHONE_WAITING_ADVISOR_REPLY, /no está registrado/i);
assert.doesNotMatch(
  UNREGISTERED_PHONE_WAITING_ADVISOR_REPLY,
  /ticket\s+\d+/i,
  "constante waiting: sin número de ticket",
);
assert.doesNotMatch(
  UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY,
  /Ya tenemos tu consulta|Gracias por tu paciencia/i,
  "no usar el aviso largo de calma",
);
assert.doesNotMatch(
  UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY,
  /ticket\s+\d+/i,
  "primera respuesta: sin número de ticket",
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

const waitingBundled = buildUnregisteredPhoneWaitingHandoffMessage("0209266");
const waitingExt = extractMediaUrlAndCleanText(waitingBundled);
assert.equal(waitingExt.text, waiting, "recontacto limpio");
assert.ok(waitingExt.mediaUrl, "recontacto también adjunta PDF");

const first = extractMediaUrlAndCleanText(
  buildUnregisteredPhoneCustomerReply({ isFirstNotify: true, ticketCode: "X" }),
);
const again = extractMediaUrlAndCleanText(
  buildUnregisteredPhoneCustomerReply({ isFirstNotify: false, ticketCode: "0209266" }),
);
assert.ok(first.text.length > 0 && first.mediaUrl, "1ª vez no vacío + PDF");
assert.ok(again.text.length > 0 && again.mediaUrl, "recontacto no vacío + PDF");
assert.doesNotMatch(again.text, /0209266|ticket\s+\d+/i, "recontacto reply sin ticket");

assert.equal(
  looksLikeJustRegisteredPhoneInWara("Listo ya lo acabo de cargar"),
  true,
  "detecta alta de número",
);
assert.equal(
  looksLikeJustRegisteredPhoneInWara("necesito cargarle el odometro"),
  false,
  "no confunde cargar odómetro",
);
const recheck = extractMediaUrlAndCleanText(
  buildUnregisteredPhoneCustomerReply({
    isFirstNotify: false,
    ticketCode: "0209266",
    recheckAfterLoad: true,
  }),
);
assert.equal(recheck.text, UNREGISTERED_PHONE_RECHECK_AFTER_LOAD_REPLY, "reconsulta sin guía");
assert.ok(!recheck.mediaUrl, "reconsulta no reenvía el PDF");
assert.match(recheck.text, /Volv[ií] a consultar Wara/i, "dice que buscó de nuevo");
assert.doesNotMatch(recheck.text, /gu[ií]a/i, "no pide de nuevo la guía");

assert.deepEqual(waraPhoneLookupCandidates("5492617172616"), [
  "5492617172616",
  "542617172616",
]);
assert.deepEqual(waraPhoneLookupCandidates("+54 261 717-2616"), [
  "542617172616",
  "5492617172616",
]);

console.log("OK verify-unregistered-phone-handoff");
