#!/usr/bin/env node
/**
 * Regresión — bug OST 225, 2026-07-30:
 * 1) "¿Qué casos pueden derivar a un ticket técnico?" → guía informativa, no agente genérico.
 * 2) "En realidad quiero consultar el reporte de una unidad" → pedir patente, no reusar activeUnit.
 */
import assert from "node:assert";
import {
  looksLikeTicketCreationInfoQuestion,
  buildTicketCreationInfoReply,
  looksLikeGenericUnitConsultWithoutPlate,
  looksLikeLiveUnitConsultIntent,
} from "../src/lib/waraApi.ts";
import { shouldUseActiveUnitFallback } from "../src/lib/activeUnit.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

console.log("▶ looksLikeTicketCreationInfoQuestion");
check(
  "casos derivar ticket tecnico",
  looksLikeTicketCreationInfoQuestion("¿Que casos pueden derivar a un ticket tecnico?"),
);
check(
  "no confunde con abrir caso",
  !looksLikeTicketCreationInfoQuestion("Quiero abrir un ticket por la unidad OST 225"),
);
check(
  "no confunde con caso abierto",
  !looksLikeTicketCreationInfoQuestion("¿Tengo un caso abierto?"),
);

console.log("\n▶ buildTicketCreationInfoReply");
const ticketInfo = buildTicketCreationInfoReply();
check("menciona sin reportar", /sin reportar/i.test(ticketInfo));
check("menciona detenida", /detenida/i.test(ticketInfo));

console.log("\n▶ looksLikeGenericUnitConsultWithoutPlate");
check(
  "en realidad consultar reporte de una unidad",
  looksLikeGenericUnitConsultWithoutPlate("En realidad quiero consultar el reporte de una unidad"),
);
check(
  "consulta con patente NO es genérica",
  !looksLikeGenericUnitConsultWithoutPlate("Quiero consultar el reporte de OST 225"),
);
check(
  "sigue siendo live consult",
  looksLikeLiveUnitConsultIntent("En realidad quiero consultar el reporte de una unidad"),
);

console.log("\n▶ shouldUseActiveUnitFallback");
check(
  "no fallback con consulta genérica",
  !shouldUseActiveUnitFallback("En realidad quiero consultar el reporte de una unidad"),
);
check(
  "sigue fallback con follow-up vago sobre misma unidad",
  shouldUseActiveUnitFallback("y la ignición?"),
);

console.log(`\n✅ ${passed} checks pasaron.`);
