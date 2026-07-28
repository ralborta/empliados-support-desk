#!/usr/bin/env node
/**
 * Regresión — Bug real, producción 2026-07-28: "Quiero saber en qué empresa estoy
 * operando" recibía el genérico "¿En qué te puedo ayudar?" en vez de una respuesta,
 * porque la rama que maneja `looksLikeCompanyListQuestion` solo ponía nextFlow="reply"
 * confiando en que otro chequeo previo (que exigía contactsCount > 1) ya hubiese llenado
 * el mensaje. Si Wara devolvía 0 o 1 contacto en ese turno, el mensaje quedaba vacío.
 *
 * `buildCompanyStatusReply` ahora arma la respuesta con lo que ya sabemos, sin esa
 * dependencia oculta.
 */
import assert from "node:assert";
import { looksLikeCompanyListQuestion, buildCompanyStatusReply } from "../src/lib/waraApi.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

console.log("▶ looksLikeCompanyListQuestion detecta la pregunta real del bug");
for (const msg of [
  "Quiero saber en qué empresa estoy operando",
  "en que empresa estoy operando",
  "con que empresa estoy trabajando",
  "que empresa tengo asociada",
  "cual es mi empresa",
]) {
  check(`"${msg}" es pregunta de empresa`, looksLikeCompanyListQuestion(msg));
}

console.log("\n▶ buildCompanyStatusReply — bug real: 1 solo contacto (o 0) no debe dar mensaje vacío");
const reply1 = buildCompanyStatusReply("El Cacique S.A.", 1, "");
check("con empresa activa y 1 contacto, responde con la empresa (no vacío)", reply1.includes("El Cacique S.A."));
check("no queda vacío", reply1.trim().length > 0);

const reply0 = buildCompanyStatusReply("El Cacique S.A.", 0, "");
check("con empresa activa y 0 contactos (lookup falló), igual responde con la empresa", reply0.includes("El Cacique S.A."));

console.log("\n▶ buildCompanyStatusReply — multiempresa sigue mostrando el menú (comportamiento previo intacto)");
const menuText = "1. WARA\n2. El Cacique S.A.";
const replyMulti = buildCompanyStatusReply("WARA", 2, menuText);
check("menciona la empresa activa", replyMulti.includes("Estás operando con WARA"));
check("incluye el menú de otras empresas asociadas", replyMulti.includes(menuText));
check("incluye instrucción para cambiar de empresa", replyMulti.toLowerCase().includes("cambiar empresa"));

console.log("\n▶ buildCompanyStatusReply — sin empresa activa todavía");
const replyNoCompanyWithMenu = buildCompanyStatusReply("", 2, menuText);
check("sin empresa activa pero con menú, lo muestra", replyNoCompanyWithMenu.includes(menuText));

const replyNoCompanyNoMenu = buildCompanyStatusReply("", 0, "");
check("sin empresa y sin menú, pide el nombre en vez de mensaje vacío", replyNoCompanyNoMenu.trim().length > 0);
check("no repite el genérico inútil", !replyNoCompanyNoMenu.includes("¿En qué te puedo ayudar?"));

console.log(`\n✓ ${passed} checks OK — verify-company-status-question`);
