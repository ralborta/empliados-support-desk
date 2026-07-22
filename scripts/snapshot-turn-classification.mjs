#!/usr/bin/env node
/**
 * Foto exhaustiva del comportamiento ACTUAL de classifyTurnExecutor (antes del refactor).
 * Genera prisma/../scripts/turn-classification.snapshot.json con inputs representativos
 * de cada rama conocida. Se usa para diffear byte a byte contra el comportamiento
 * DESPUÉS del refactor — cualquier diferencia debe ser explicada, no asumida.
 *
 * Uso: npx tsx scripts/snapshot-turn-classification.mjs [--write]
 *   Sin --write: solo imprime y compara contra el snapshot existente (modo CI/gate).
 *   Con --write: regenera el snapshot (usar SOLO cuando un cambio de comportamiento es intencional).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { threadTextSinceCompanySelection } from "../src/lib/wara.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.join(__dirname, "turn-classification.snapshot.json");

function turnRoute(text, fullThread = "") {
  const scoped = threadTextSinceCompanySelection(fullThread);
  const classificationThread = scoped.trim() ? `${scoped}\n${text}`.trim() : text;
  return classifyTurnExecutor(text, classificationThread);
}

// ---- Hilos representativos reutilizables ----
const T = {
  empty: "",
  genericMenu: [
    "Puedo guiarte sobre los módulos Opciones, Unidades o Mantenimiento de Wara.",
    "Decime cuál te interesa o qué querés configurar.",
  ].join("\n"),
  odoActive: "Para registrar el cambio de odómetro necesito la patente de la unidad.",
  odoPendingConfirm: [
    "Voy a registrar:",
    "• Patente: AD 427 MC",
    "• Odómetro: 125000 km",
    "Si está correcto, respondé CONFIRMO para registrarlo en Wara.",
  ].join("\n"),
  maintPendingConfirm: [
    "Voy a registrar:",
    "Patente: AD427MC",
    "Tipo: Correctivo",
    "Prioridad: normal",
    "Detalle: ruido en motor",
    "Si esta correcto, responde CONFIRMO para registrarlo.",
  ].join("\n"),
  certPendingConfirm: [
    "Voy a generar el certificado de cobertura:",
    "Patente: AE 483 VE",
    "Empresa: WARA",
    "Si esta correcto, responde CONFIRMO para solicitarlo a Wara.",
  ].join("\n"),
  certAwaitingUnit:
    "Para el certificado de cobertura necesito la unidad: decime la patente (ej. AD 427 MC), el nombre o la marca (ej. Saveiro, Nissan) o un prefijo (ej. HEJ).",
  maintPendingPlate:
    "Para registrar el mantenimiento necesito la patente de la unidad (formato AA123BB o ABC123) junto con un breve detalle y, si querés, la prioridad.",
  maintGuideInThread: [
    "El mantenimiento preventivo se programa cada 10.000km o 6 meses, lo que ocurra primero.",
    "El correctivo se registra cuando detectás una falla puntual.",
  ].join("\n"),
  platformInfoOpciones: [
    "Para configurar la Agenda: entrá a Opciones > Agenda > Agregar contacto.",
    "Podés agregar tantos contactos como necesites.",
  ].join("\n"),
  postAdvisorCase: [
    "Te derivé con un asesor. Tu caso es TCK-000123.",
    "Un agente te va a contactar a la brevedad.",
  ].join("\n"),
  odoFlowSuperseded: [
    "Para registrar el cambio de odómetro necesito la patente de la unidad.",
    "Necesito un certificado de cobertura para AD427MC",
  ].join("\n"),
};

// ---- Matriz de casos: [descripcion, text, threadText] ----
const CASES = [
  // Listado / flota
  ["listado de unidades", "Quiero el listado de mis unidades", T.empty],
  ["cuantas unidades tengo", "¿Cuántas unidades tengo en Wara?", T.empty],

  // Cierre / estado de caso / asesor humano
  ["cerrar caso", "Quiero cerrar mi caso", T.empty],
  ["caso abierto", "¿Tengo algún caso abierto?", T.empty],
  ["asesor humano", "Quiero hablar con un asesor humano", T.empty],
  ["reclamo explicito", "Quiero hacer un reclamo formal", T.empty],
  ["soporte tecnico", "Quiero soporte técnico", T.empty],
  ["soporte tecnico en menu generico", "Quiero soporte técnico", T.genericMenu],

  // Falla de odómetro (soporte, no menú)
  ["falla odometro", "El odómetro no me está marcando bien", T.empty],
  ["falla odometro en menu generico", "No el odometro no está marcando bien", T.genericMenu],

  // GPS / consulta en vivo
  ["gps sin reporte", "La unidad AD427MC no está reportando", T.empty],
  ["ignicion pregunta", "¿Está encendida la AD 427 MC?", T.empty],
  ["consulta viva con patente", "Decime el último reporte de AD427MC", T.empty],

  // Odómetro operativo
  ["odometro explicito con patente", "Quiero actualizar el odómetro de AD427MC a 125000 km", T.empty],
  ["odometro activo + patente", "AD 427 MC", T.odoActive],
  ["odometro activo + correccion patente", "no es esa, es la AH562SP", T.odoActive],
  ["correccion patente en hilo odometro", "cambiar la patente a AD427MC", "Odómetro: 100000 km registrado ayer"],

  // Mantenimiento: patente pedida
  ["patente tras pedido mantenimiento", "AD427MC", T.maintPendingPlate],
  ["prefijo tras pedido mantenimiento", "AD", T.maintPendingPlate],
  ["marca tras pedido mantenimiento + consulta viva reciente", "Nissan", `${T.maintPendingPlate}\n¿Cómo está reportando la Nissan?`],

  // Guías informativas
  ["guia opciones agenda", "¿Cómo configuro la agenda?", T.empty],
  ["guia mantenimiento informativo", "¿Cómo funciona el módulo de mantenimiento?", T.empty],
  ["guia unidades informativo", "¿Qué significa el punto rojo en unidades?", T.empty],
  ["pick modulo tras menu generico", "Ok mantenimiento", T.genericMenu],
  ["reproceso tras guia mantenimiento", "ok gracias", T.maintGuideInThread],
  ["reproceso tras guia opciones", "gracias, muy claro", T.platformInfoOpciones],
  ["pregunta guia tras menu opciones", "¿y cómo agrego otro contacto?", T.platformInfoOpciones],

  // Confirmaciones pendientes (prioridad cert > odo > maint)
  ["confirmo pendiente odometro", "Confirmo", T.odoPendingConfirm],
  ["confirmo pendiente mantenimiento", "Confirmo", T.maintPendingConfirm],
  ["confirmo pendiente certificado", "Confirmo", T.certPendingConfirm],
  ["si pendiente odometro", "si", T.odoPendingConfirm],
  ["dale pendiente mantenimiento", "dale", T.maintPendingConfirm],

  // Post asesor: no reabrir con ack/confirmo suelto
  ["gracias tras derivacion", "gracias", T.postAdvisorCase],
  ["confirmo tras derivacion sin pendiente", "confirmo", T.postAdvisorCase],
  ["gps tras derivacion", "¿la unidad AD427MC está reportando?", T.postAdvisorCase],

  // Certificado
  ["certificado explicito", "Necesito un certificado de cobertura para AD427MC", T.empty],
  ["patente tras pedido certificado", "AD 427 MC", T.certAwaitingUnit],
  ["marca tras pedido certificado", "Nissan", T.certAwaitingUnit],
  ["prefijo tras pedido certificado", "HEJ", T.certAwaitingUnit],

  // Mantenimiento operativo directo
  ["mantenimiento operativo directo (palabra completa)", "Quiero programar un mantenimiento correctivo para AD427MC", T.empty],
  // Regresión: "correctivo"/"preventivo" sin la palabra "mantenimiento" — arreglado 2026-07-22
  // (bug de \b word-boundary: \bcorrectiv\b no matcheaba "correctivo"). Ver docs/bbc-flows-eliminados-2026-07-22.md.
  ["mantenimiento operativo directo (solo correctivo, sin palabra completa)", "Quiero programar un correctivo para AD427MC", T.empty],
  ["mantenimiento operativo directo (solo preventivo, sin palabra completa)", "Necesito agendar un preventivo para AD427MC", T.empty],
  ["mantenimiento capability question", "¿Atilio puede registrar el mantenimiento por WhatsApp?", T.maintGuideInThread],

  // Incidentes administrativos
  ["derivacion administrativa", "No puedo entrar a la plataforma, me tira error de acceso", T.empty],

  // Fallback con patente/prefijo/operativo
  ["patente suelta sin contexto", "AD427MC", T.empty],
  ["prefijo suelto sin contexto", "AD", T.empty],
  ["patente suelta con odometro activo en hilo", "AD427MC", T.odoFlowSuperseded],

  // Fallback reclamo por palabra clave
  ["palabra clave problema", "Tengo un problema con mi cuenta", T.empty],

  // Reinicio / flujo de control (no debe secuestrar confirmaciones)
  ["reinicio con confirmacion pendiente odometro", "reinicio", T.odoPendingConfirm],
  ["cancelar con confirmacion pendiente mantenimiento", "cancelar", T.maintPendingConfirm],

  // Saludo / ambiguo puro (fallback final)
  ["mensaje ambiguo corto", "hola de nuevo", T.empty],
];

function buildSnapshot() {
  return CASES.map(([label, text, threadText]) => ({
    label,
    text,
    threadTextPreview: threadText.slice(0, 60),
    executor: turnRoute(text, threadText),
  }));
}

function main() {
  const write = process.argv.includes("--write");
  const current = buildSnapshot();

  if (write || !fs.existsSync(SNAPSHOT_PATH)) {
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2) + "\n");
    console.log(`✓ Snapshot escrito: ${SNAPSHOT_PATH} (${current.length} casos)`);
    return;
  }

  const previous = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
  const prevByLabel = new Map(previous.map((c) => [c.label, c]));
  const curByLabel = new Map(current.map((c) => [c.label, c]));

  let diffs = 0;
  for (const [label, cur] of curByLabel) {
    const prev = prevByLabel.get(label);
    if (!prev) {
      console.log(`+ NUEVO caso "${label}" → ${cur.executor}`);
      continue;
    }
    if (prev.executor !== cur.executor) {
      diffs++;
      console.error(`✗ DIFERENCIA "${label}": ${prev.executor} → ${cur.executor}`);
    }
  }
  for (const [label] of prevByLabel) {
    if (!curByLabel.has(label)) {
      console.log(`- caso eliminado "${label}"`);
    }
  }

  if (diffs > 0) {
    console.error(`\n✗ ${diffs} diferencia(s) de comportamiento vs snapshot previo.`);
    console.error(`Si es un cambio intencional, correr con --write para actualizar el snapshot.`);
    process.exit(1);
  }
  console.log(`\n✓ Sin diferencias vs snapshot previo (${current.length} casos comparados).`);
}

main();
