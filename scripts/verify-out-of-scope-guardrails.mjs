#!/usr/bin/env node
import assert from "node:assert/strict";
import { looksLikeOutOfScopeSupportClaim } from "../src/lib/waraApi.ts";

const mustStayInScope = [
  "QUE MAS PODES HACER",
  "estado gps de AG 382 QB",
  "M400-105 NO REPORTA ETAPA AV. P. MOLINA (VUELTA)",
  "quiero cambiar el odómetro",
  "necesito el certificado de cobertura",
  "agenda de mantenimiento preventivo",
  "cómo uso el módulo de unidades",
  "me podes ayudar?",
  "Indícame el reporte de la nissan",
  "donde esta la unidad",
  "no reporta desde ayer AD832BN",
  "problema con el certificado en la app",
  "la app no me muestra el historial de la unidad",
  "falla de ignicion M400-105",
  "como configuro mis atajos",
];

const mustHandoff = [
  "la pantalla táctil del equipo está rota",
  "necesito reclamar la factura del mes",
  "el teclado del modem no funciona",
  "quiero reclamar la garantía del hardware",
];

for (const s of mustStayInScope) {
  assert.equal(
    looksLikeOutOfScopeSupportClaim(s),
    false,
    `NO derivar (en alcance): ${s}`,
  );
}
for (const s of mustHandoff) {
  assert.equal(
    looksLikeOutOfScopeSupportClaim(s),
    true,
    `SÍ derivar (fuera de alcance): ${s}`,
  );
}

console.log("OK verify-out-of-scope-guardrails");
