#!/usr/bin/env node
/**
 * Regresión bug real 2026-07-28 (captura cliente, unidad AF061DO / El Cacique S.A.):
 * un cliente sin empresa asociada respondió "la empresa es el cacique, la unidad es la
 * AF061DO" al pedido de elegir empresa. Como el mensaje TAMBIÉN calificaba como intención
 * operativa (mencionaba "unidad" + una patente), `matchCompanyContinuationMention` no lo
 * reconocía (sobran palabras: "empresa", "es", "unidad", "af061do" — más de las 4
 * permitidas) y el mensaje se mandaba al router genérico sin haber registrado la empresa,
 * repitiendo en loop "Antes de consultar unidades necesito que elijas la empresa asociada
 * a este número.".
 */
import {
  extractExplicitCompanyMention,
  matchCompanyContinuationMention,
  looksLikeOperationalIntent,
  looksLikeCompanySelection,
} from "../src/lib/waraApi.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const contacts = [
  { id: 11, empresa: "El Cacique S.A.", nombre: "El Cacique S.A." },
  { id: 22, empresa: "WARA", nombre: "WARA" },
];

console.log("— Caso real del cliente: empresa + unidad en el mismo mensaje —");
const msg = "la empresa es el cacique, la unidad es la AF061DO";
assert(
  looksLikeCompanySelection(msg) === false,
  "looksLikeCompanySelection sigue sin reconocerlo (esperado, por eso hace falta el nuevo helper)",
);
assert(
  matchCompanyContinuationMention(msg, contacts) === null,
  "matchCompanyContinuationMention sigue sin reconocerlo (esperado, demasiadas palabras extra)",
);
assert(
  looksLikeOperationalIntent(msg) === true,
  "el mensaje también califica como intención operativa (por eso el bug real)",
);
const matched = extractExplicitCompanyMention(msg, contacts);
assert(matched?.id === 11, `extractExplicitCompanyMention resuelve "El Cacique S.A." (obtuvo: ${matched?.empresa})`);

console.log("\n— Otras formas de declarar la empresa explícitamente —");
assert(
  extractExplicitCompanyMention("Quiero operar con la empresa El Cacique.", contacts)?.id === 11,
  '"Quiero operar con la empresa El Cacique." resuelve El Cacique (menú post-reinicio)',
);
assert(
  extractExplicitCompanyMention("la empresa es el cacique", contacts)?.id === 11,
  '"la empresa es el cacique" (sola) también resuelve',
);
assert(
  extractExplicitCompanyMention("empresa: wara", contacts)?.id === 22,
  '"empresa: wara" resuelve',
);
assert(
  extractExplicitCompanyMention("la empresa es wara y la unidad es AB123CD", contacts)?.id === 22,
  '"la empresa es wara y la unidad es AB123CD" resuelve WARA',
);
assert(
  extractExplicitCompanyMention("la empresa es cacique. tengo la patente AB123CD sin reporte", contacts)?.id === 11,
  "corta correctamente en el punto antes de la patente",
);

console.log("\n— No debe generar falsos positivos —");
assert(
  extractExplicitCompanyMention("tengo la unidad sin reporte AF061DO", contacts) === null,
  "mensaje operativo sin mención de empresa sigue devolviendo null",
);
assert(
  extractExplicitCompanyMention("necesito el certificado de la unidad AB123CD", contacts) === null,
  "pedido de certificado sin mención de empresa sigue devolviendo null",
);
assert(
  extractExplicitCompanyMention("hola, buenas", contacts) === null,
  "saludo normal sigue devolviendo null",
);
assert(
  extractExplicitCompanyMention("quiero continuar con el cacique", contacts) === null,
  '"quiero continuar con el cacique" sigue cubierto por matchCompanyContinuationMention, no por este helper',
);
assert(
  matchCompanyContinuationMention("quiero continuar con el cacique", contacts)?.id === 11,
  "…y matchCompanyContinuationMention lo sigue resolviendo sin cambios",
);
assert(
  extractExplicitCompanyMention("la empresa no me deja entrar", contacts) === null,
  '"la empresa no me deja entrar" (queja, no declaración) no matchea ninguna empresa real',
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Declaración explícita de empresa junto a contenido operativo OK");
