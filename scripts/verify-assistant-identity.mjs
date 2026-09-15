#!/usr/bin/env node
/**
 * LIVE LLM read-only — identidad oficial Kira.
 * No llama /turn/execute, no envía WhatsApp y no escribe estado.
 */
import assert from "node:assert/strict";
import { loadVerifyEnv } from "./load-verify-env.mjs";

loadVerifyEnv();
process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "true";

const {
  interpretPlatformKnowledgeTurn,
  isAssistantIdentityInterpret,
} = await import("../src/lib/infoGuideInterpretAI.ts");
const { buildGroundedInfoGuideReplyWithMeta } = await import(
  "../src/lib/infoGuideReplies.ts"
);
const { resolveTurnExecutor } = await import(
  "../src/lib/whatsappTurnClassifierAI.ts"
);

const identityCases = [
  "¿Cómo es tu nombre?",
  "Quiero saber cuál es tu nombre",
  "¿Cómo te llamás?",
  "¿Quién sos?",
];

for (const text of identityCases) {
  const interpret = await interpretPlatformKnowledgeTurn({
    selectionText: text,
    threadText:
      "Kira: Para usar Mantenimiento, entrá a Utilidades. Cliente: Gracias.",
    pendingActionType: "odometro",
    lastGuideKind: "mantenimiento",
  });
  assert(isAssistantIdentityInterpret(interpret), `${text}: assistant_identity`);
  assert.equal(interpret.route, "info_guides", `${text}: ruta directa`);
  assert.equal(interpret.guideKind, null, `${text}: sin módulo`);
  assert.deepEqual(interpret.articleIds, [], `${text}: sin artículos`);
  assert.equal(interpret.clarifyQuestion, null, `${text}: sin aclaración`);

  const reply = await buildGroundedInfoGuideReplyWithMeta(
    text,
    null,
    null,
    "",
    interpret,
  );
  assert.match(reply.message, /^Soy Kira,/);
  assert.equal(reply.guideKind, null);
  assert.equal(reply.fallback, null);
  const resolved = await resolveTurnExecutor(
    text,
    "Kira: Para usar Mantenimiento, entrá a Utilidades.",
    null,
    { lastGuideKind: "mantenimiento" },
  );
  assert.equal(resolved.executor, "info_guides");
  assert.equal(resolved.ruleId, "assistant_identity");
  assert.equal(resolved.interpret?.normalTarget, "assistant_identity");
  console.log(JSON.stringify({ text, target: interpret.normalTarget, reply: reply.message }));
}

for (const text of [
  "¿Cómo cambio el nombre de una unidad?",
  "¿Cómo se llama el informe de recorridos?",
]) {
  const interpret = await interpretPlatformKnowledgeTurn({
    selectionText: text,
    threadText: "",
  });
  assert(
    !isAssistantIdentityInterpret(interpret),
    `${text}: no confundir nombre de entidad/módulo con identidad`,
  );
}

console.log("verify-assistant-identity: OK");
