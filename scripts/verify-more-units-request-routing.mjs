#!/usr/bin/env node
/**
 * Regresión real, producción 2026-07-28: dentro de un trámite de certificado
 * ("necesito la unidad"), tras mostrar el listado parcial de la flota ("Tenés 73
 * unidades... Te muestro 8 como referencia..."), el cliente pidió "mas unidades"
 * (quería ver más opciones de la lista, no seleccionar una unidad puntual).
 *
 * looksLikeUnitListRequest no reconocía esa frase, así que la ruta de seguridad
 * "unit_list_request" (prioridad sobre certificate_unit_context_selection) nunca
 * se activaba. El mensaje caía en isUnitSelectionMessage → isMaintenancePlateSelectionMessage
 * (heurística permisiva: cualquier texto corto sin palabras prohibidas cuenta como
 * "selección de unidad"), así que el turno se enrutaba a "certificados" y el resolver
 * de flota (IA) terminaba "inventando"/asignando una patente (ej. GP30) sin relación
 * con lo que pidió el cliente — el bot pasaba directo a "Voy a generar el certificado
 * de cobertura... Patente: GP30... Respondé CONFIRMO" sobre una unidad que nadie pidió.
 */
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { looksLikeUnitListRequest } from "../src/lib/waraUnitIntent.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— looksLikeUnitListRequest reconoce pedidos de 'más unidades' —");
for (const msg of [
  "mas unidades",
  "más unidades",
  "dame mas unidades",
  "mostrame mas unidades",
  "ver mas unidades",
  "otras unidades",
  "mas opciones",
  "más opciones",
]) {
  assert(looksLikeUnitListRequest(msg), `"${msg}" → pedido de listado`);
}

console.log("\n— No confundir con una selección real de unidad —");
assert(!looksLikeUnitListRequest("NKL 952"), "patente concreta NO es pedido de listado");
assert(!looksLikeUnitListRequest("la Nissan"), "marca concreta NO es pedido de listado");

console.log("\n— Router: 'mas unidades' tras listado en flujo de certificado va a 'unidades', no a 'certificados' —");
const threadTrasListado = [
  "Cliente: genera un certificado para la MYQ",
  "Atilio: No hay ninguna unidad en la flota de tu empresa con patente que empiece con MYQ. Ese prefijo no está en tu flota. Pasame la matrícula completa (ej. NKL 952) o escribí «listado de mis unidades». Para el certificado de cobertura necesito la unidad: decime la patente completa, el nombre/marca o un prefijo válido.",
  "Cliente: pasame el listado de unidades",
  "Atilio: Tenés 73 unidades en WARA. Te muestro 8 como referencia: AB006EXCANBUS, Alarma 1er Piso, ALARMA2DOPISO, ALARMAPB, ALEJANDROPICÓN, HEJ (nombre Alex Lima), I864520060172172 (nombre Alex Lima), LWK 7902 (nombre BRtestes) y 65 más. Por WhatsApp no puedo enviar las 73 de una sola vez — decime matrícula, nombre de unidad (ej. M600-157) o marca para buscar una en particular.",
].join("\n");

assert(
  classifyTurnExecutor("mas unidades", threadTrasListado) === "unidades",
  "router → unidades (no certificados) tras 'mas unidades'",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación 'mas unidades' OK");
