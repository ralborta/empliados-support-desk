#!/usr/bin/env node
/**
 * Regresión bug real 2026-09-30 (Matías García / AA 905 DL):
 * Bot pide km + fecha/hora → cliente «260486 Km - 30/09/2026 a las 11:04»
 * → Kira respondía «¿Te referís al inconveniente de la unidad AA 905 DL?»
 * en vez de seguir el trámite de odómetro.
 *
 * Uso: npx tsx scripts/verify-odometer-km-fecha-not-issue-clarify.mjs
 */
import assert from "node:assert/strict";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { isOperationalMeterCollectionMessage } from "../src/lib/tramiteMeterPrecedence.ts";
import { looksLikeFechaHoraLecturaMessage } from "../src/lib/odometroFecha.ts";
import { looksLikeMeterValueWithFechaHora } from "../src/lib/wara.ts";
import { applyPlatformGuideInterpretGuards } from "../src/lib/infoGuideInterpretAI.ts";

const msg = "260486 Km - 30/09/2026 a las 11:04";
const thread = [
  "Cliente: quiero cargar odometro AA 905 DL",
  "Kira: 🛣️ *Odómetro*",
  "Kira: 🚗 Unidad: *AA 905 DL*",
  "Kira: 🔢 Pasame el valor del odómetro en km y la fecha y hora de la lectura. Ej.: 10500 km — 05/08/26 a las 14:30",
].join("\n");

assert.equal(looksLikeFechaHoraLecturaMessage(msg), true, "fecha/hora con km combinado");
assert.equal(looksLikeMeterValueWithFechaHora(msg), true, "combined meter+fecha");
assert.equal(isOperationalMeterCollectionMessage(msg, thread), true, "meter collection");
assert.equal(classifyTurnExecutor(msg, thread), "odometro", "router → odometro");
assert.equal(
  looksLikeFechaHoraLecturaMessage("260486 Km"),
  false,
  "solo km no es fecha/hora",
);

const next = applyPlatformGuideInterpretGuards(
  {
    route: "info_guides",
    guideKind: null,
    need: "ambiguous",
    articleIds: [],
    clarifyQuestion: null,
    executionRequest: false,
    confidence: 0.9,
    reason: "llm",
    category: null,
    reportId: null,
    normalTarget: null,
  },
  msg,
  thread,
  { lastGuideKind: "alertas" },
);
assert.doesNotMatch(
  next.clarifyQuestion ?? "",
  /inconveniente de la unidad/i,
  "no clarify de inconveniente",
);
assert.equal(next.reason?.includes("ambiguous_issue_clarify"), false, "sin ambiguous_issue_clarify");

console.log("OK verify-odometer-km-fecha-not-issue-clarify");
