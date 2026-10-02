#!/usr/bin/env node
/**
 * Regresión bug real 2026-09-28:
 * Tras listado de flota + nudge idle («¿Seguís ahí?»), el cliente responde
 * «No. Gracias.» y el bot buscaba esa frase como patente → «Unidad no encontrada».
 *
 * Uso: npx tsx scripts/verify-no-gracias-not-fleet-search.mjs
 */
import {
  looksLikeConversationClosing,
  looksLikeConversationAcknowledgement,
} from "../src/lib/waraApi.ts";
import {
  extractFreeTextUnitSearchCandidate,
  shouldRouteTurnToUnidadesExecutor,
  resolveUnitQuery,
} from "../src/lib/waraUnitIntent.ts";
import {
  IDLE_NUDGE_MESSAGE,
  looksLikeIdleNudgeDecline,
  resolveIdleFollowupMetaTurn,
} from "../src/lib/idleFollowupMeta.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const thread = [
  "Cliente: Unidad ZBF1418 sin reporte",
  "Kira: 📋 *Listado de unidades*",
  "2. 🚗 *ZBF 1418* · 🔢 *35* · 🏭 s/ marca",
  "➡️ Si querés el estado de una, pasame la patente o el nro.",
  `Kira: ${IDLE_NUDGE_MESSAGE}`,
].join("\n");

const variants = ["No. Gracias.", "No. Gracias", "No, gracias", "No gracias", "no gracias."];

console.log("— Cierre / free-text / routing —");
for (const msg of variants) {
  assert(looksLikeConversationClosing(msg), `closing("${msg}")`);
  assert(
    extractFreeTextUnitSearchCandidate(msg) == null,
    `extractFreeText("${msg}") === null`,
  );
  assert(
    !shouldRouteTurnToUnidadesExecutor({ selectionText: msg, threadText: thread }),
    `!routeUnidades("${msg}")`,
  );
  assert(
    classifyTurnExecutor(msg, thread) === "info_guides",
    `classify("${msg}") === info_guides (got ${classifyTurnExecutor(msg, thread)})`,
  );
}

console.log("\n— Idle nudge decline —");
assert(looksLikeIdleNudgeDecline("No. Gracias.", thread), "idleNudgeDecline(No. Gracias.)");
assert(looksLikeIdleNudgeDecline("No", thread), "idleNudgeDecline(No)");
const meta = resolveIdleFollowupMetaTurn({
  selectionText: "No. Gracias.",
  threadText: thread,
});
assert(!!meta, "resolveIdleFollowupMetaTurn intercepts");
assert(
  meta && !/unidad no encontrada/i.test(meta.message),
  "meta reply is not fleet not-found",
);
assert(
  meta && /chau|avisame|cualquier cosa/i.test(meta.message),
  `meta soft-close (got: ${meta?.message})`,
);

console.log("\n— resolveUnitQuery no inventa búsqueda —");
const units = [{ movil_id: 1, patente: "ZBF1418", unidad: "35", marca: null }];
const resolved = await resolveUnitQuery({
  rawText: "No. Gracias.",
  threadText: thread,
  units,
  preferAi: false,
});
  assert(
    !/No\. Gracias/i.test(resolved.clarificationQuestion ?? ""),
    `no not-found with «No. Gracias.» (got intent=${resolved.intent} q=${resolved.clarificationQuestion ?? ""})`,
  );
  assert(
    !(resolved.searchTerms ?? []).some((t) => /gracias/i.test(t)),
    `searchTerms sin gracias (got ${JSON.stringify(resolved.searchTerms)})`,
  );
  assert(
    (resolved.searchTerms ?? []).length === 0 &&
      !(resolved.clarificationQuestion ?? "").trim(),
    "resolveUnitQuery cierra sin buscar (sin pregunta de flota)",
  );

console.log("\n— Sanity: patente real sigue yendo a flota —");
assert(
  shouldRouteTurnToUnidadesExecutor({ selectionText: "ZBF1418", threadText: thread }),
  "routeUnidades(ZBF1418)",
);
assert(
  !looksLikeConversationClosing("ZBF1418"),
  "!closing(ZBF1418)",
);
assert(
  looksLikeConversationAcknowledgement("gracias"),
  "ack(gracias) sigue OK",
);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nOK");
