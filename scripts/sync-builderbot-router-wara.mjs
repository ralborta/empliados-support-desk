#!/usr/bin/env node
/**
 * Actualiza reglas del Router Wara: listado vs certificado, umbral 1h, negativas.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const PROJECT_ID = "7d4339ee-2a9b-424e-92f6-ad7790c1662f";
const FLOW_ID = "5895dde2-c0df-41c2-8a35-0895331aefbf";
const ANSWER_ID = "f76bc8b9-5f95-4f68-84e0-f2f06bedb8a8";

const F = {
  confirmOdo: "b1062a92-0d72-4f90-bcd9-2fa90d76b95f",
  confirmMaint: "e893d57f-faca-490f-85a1-d833aa926b9a",
  confirmCert: "8f4c81a0-e3ca-4c79-b1c5-d94ce6d661e2",
  elegirEmpresa: "c4b5127a-76fd-4cb2-8b43-d99685b5c50a",
  cambiarEmpresa: "3693a7a9-b5f2-4a66-97f3-acef85dab201",
  odometer: "ae2a5ae9-c289-448c-a068-3cb8c65a2e7f",
  ejecutarConsulta: "29a8afe6-2414-42bd-8a17-4baaa93d9b44",
  consultarUnidad: "5939a04e-5a5a-4c59-83b6-31172eba4828",
  certificados: "fd2e658c-f547-4ec6-b64f-00815620bd6b",
  gestionMaint: "42b29014-7560-4a67-bc09-0201eb1efdd5",
  infoMaint: "069bcb65-7503-433c-a4ae-1dd89cd26471",
  infoOpciones: "312ea5a6-0493-43e6-b026-05d14bcb6436",
  infoUnidades: "52f8a36b-819b-4edb-aeb7-677041797a31",
  asesor: "f75f176c-d0b0-4aa4-a579-6af9c53cb4e0",
  atilio: "e3e7ad1c-27a9-40a8-8556-a24b758a29c6",
  ignorar: "03d37040-357d-4b17-9c23-2ba8ac706454",
};

function loadMcp() {
  const cfg = JSON.parse(readFileSync(path.join(homedir(), ".cursor/mcp.json"), "utf8"));
  const args = cfg?.mcpServers?.["builderbot-mcp"]?.args;
  if (!Array.isArray(args)) throw new Error("builderbot-mcp no configurado");
  const header = args.find((a) => String(a).startsWith("x-builderbot-api-key:"));
  const key = header.split(":", 2)[1].trim();
  const sseUrl = args[args.indexOf("--sse") + 1];
  return { key, sseUrl };
}

function buildRules() {
  return [
    {
      conditionRule:
        'CORRECCIÓN DE PATENTE/MATRÍCULA EN ODÓMETRO (NO ES CAMBIAR EMPRESA) — Por CONTEXTO: el historial reciente es trámite de cambio de odómetro u horómetro (bot pidió patente, odómetro, o hay resumen "Voy a registrar" con odómetro) y el mensaje actual corrige la unidad: "cambiar matrícula", "cambiar patente", "corregir matrícula/patente", "no es la correcta", "me equivoqué de patente/matrícula", u otra patente para reemplazar la anterior. Va a odómetro. PROHIBIDO enrutar a cambiar de empresa.',
      conditionValue: "",
      condition: "",
      conditionFlowId: F.odometer,
    },
    {
      conditionRule:
        'CAMBIAR DE EMPRESA — PRIORIDAD MÁXIMA. Frases: "cambiar empresa", "cambiarme de empresa", "quiero cambiar de empresa", "otra empresa", typos similares. PROHIBIDO si el mensaje es trámite concreto (mantenimiento con detalle, patente, certificado, reporte). PROHIBIDO si dice cambiar/corregir matrícula o patente (corregir la unidad del trámite en curso, NO cambiar de empresa Wara). PROHIBIDO si el mensaje es marca o nombre de unidad (Nissan, Toyota, Saveiro, Sprinter, etc.) o búsqueda de unidad — aunque el historial mencione "cambiar empresa" como sugerencia del bot. La elección 1/2/WARA la procesa Inicio.',
      conditionValue: "",
      condition: "",
      conditionFlowId: F.cambiarEmpresa,
    },
    {
      conditionRule:
        "CONFIRMACIÓN DE ODÓMETRO. Interpretá por CONTEXTO: en el turno anterior el bot resumió un cambio de ODÓMETRO/HORÓMETRO (Voy a registrar + patente + odómetro) y pidió confirmación, y ahora el cliente acepta de forma natural: CONFIRMO, Confirmo, confirmo, sí, dale, ok, listo o correcto. Solo aplica si ese último resumen era de odómetro/horómetro; no si era de mantenimiento o certificado.",
      conditionValue: "",
      condition: "",
      conditionFlowId: F.confirmOdo,
    },
    {
      conditionRule:
        "CONFIRMACIÓN DE MANTENIMIENTO. Por CONTEXTO: el turno anterior del bot fue un resumen de una GESTIÓN DE MANTENIMIENTO operativa pidiendo confirmación, y el cliente ahora acepta. No aplica a preguntas informativas del módulo ni si el resumen era de odómetro/horómetro o certificado.",
      conditionValue: "",
      condition: "",
      conditionFlowId: F.confirmMaint,
    },
    {
      conditionRule:
        "CONFIRMACIÓN DE CERTIFICADO — PRIORIDAD ABSOLUTA SOBRE SOLICITAR CERTIFICADO. Usá esta regla cuando el historial reciente contiene el resumen 'Voy a generar el certificado de cobertura' o 'Si está correcto, responde CONFIRMO' y el mensaje actual del cliente es una aceptación breve: CONFIRMO, Confirmo, confirmado, confirma, sí, dale, ok, correcto, perfecto, listo, o una patente + confirmo. Aunque el mensaje actual solo diga 'Confirmo', NO lo trates como nueva solicitud de certificado: debe ir al ejecutor confirmado.",
      conditionValue: "",
      condition: "",
      conditionFlowId: F.confirmCert,
    },
    {
      conditionRule:
        'REPROCESO TRAS GUÍA INFORMATIVA — Por CONTEXTO del historial: el bot ya respondió con pasos de Opciones Wara (Agenda/contactos/Perfiles/Notificaciones), del módulo Unidades (grupos, ficha expandida, MIS ATAJOS, puntos de color, Crear grupo) o del módulo de Mantenimiento (guía preventiva/correctiva/planes, sin pedir patente) y el cliente NO está iniciando mantenimiento operativo, certificado, consulta de reporte en vivo ni odómetro. PROHIBIDO Gestión Mantenimiento y PROHIBIDO pedir patente. El turno informativo terminó.',
      conditionValue: "",
      condition: "",
      conditionFlowId: F.ignorar,
    },
    {
      conditionRule:
        'TURNO / AGENDA (OPCIONES WARA) — El cliente pregunta cómo cargar, crear, agendar o recordar un turno (turnos de agenda/operación), no mantenimiento de unidad ni tarea preventiva/correctiva. Incluye: "cargar un turno", "turno nuevo", "agendar turno". PROHIBIDO Gestión Mantenimiento operativo e Info Mantenimiento si el tema es turno/agenda.',
      conditionValue: "",
      condition: "",
      conditionFlowId: F.infoOpciones,
    },
    {
      conditionRule:
        "PATENTE PARA CERTIFICADO — Si el bot acaba de pedir la patente para certificado de cobertura (por ejemplo 'necesito la patente' / 'enviámela en un mensaje') y el cliente responde solo con una patente (AB006EX, AD 427 MC, etc.), va a certificados. PRIORIDAD sobre consulta de unidad o listado cuando el contexto reciente es certificado, no consulta de reporte.",
      conditionValue: "",
      condition: "",
      conditionFlowId: F.certificados,
    },
    {
      conditionRule:
        "PATENTE PARA MANTENIMIENTO — Si el bot acaba de pedir la patente para registrar o programar mantenimiento (preventivo, correctivo, tarea o plan) y el cliente responde solo con una patente (AD 427 MC, ABC123, etc.) o patente + detalle corto del trabajo, va a Gestión Mantenimiento. PRIORIDAD sobre consulta de unidad/certificado cuando el contexto reciente es mantenimiento operativo, no consulta de reporte ni certificado.",
      conditionValue: "",
      condition: "",
      conditionFlowId: F.gestionMaint,
    },
    {
      conditionRule:
        'SALUDO SOLO — PRIORIDAD SOBRE CONSULTA CON HISTORIAL. El mensaje actual es únicamente o casi únicamente un saludo corto (hola, buenos días, buenas tardes, buenas noches, buenas, qué tal, hey) sin patente nueva ni pedido operativo (reporte, certificado, odómetro, mantenimiento, asesor). Retomar en Atilio; NO consultar Wara ni reusar patente del historial. PROHIBIDO Ejecutar Consulta Unidad y PROHIBIDO listado/mis unidades.',
      conditionValue: "",
      condition: "",
      conditionFlowId: F.atilio,
    },
    {
      conditionRule:
        'CERRAR CASO / CONVERSACIÓN — PRIORIDAD SOBRE ASESOR. El cliente pide cerrar, resolver o finalizar el caso, ticket, consulta, reclamo o conversación: "cerrar caso", "quiero cerrar mi caso", "resolver conversación", "dar por cerrado", "cerrame el ticket". NO es reclamo nuevo ni pedido de patente para registrar. Va al ejecutor Odoo (backend cierra y responde). PROHIBIDO flujo asesor conversacional que pida patente.',
      conditionValue: "",
      condition: "",
      conditionFlowId: F.asesor,
    },
    {
      conditionRule:
        'CONSULTA CASO ABIERTO — PRIORIDAD SOBRE ASESOR. Pregunta si tiene un caso/ticket/reclamo abierto, activo o pendiente: "tengo un caso abierto", "hay algún ticket abierto", "caso abierto?". NO pide hablar con asesor ni registrar patente nueva. Va al ejecutor Odoo (backend responde con el estado). PROHIBIDO flujo asesor conversacional.',
      conditionValue: "",
      condition: "",
      conditionFlowId: F.asesor,
    },
    {
      conditionRule:
        'ATILIO PUEDE AYUDAR — PRIORIDAD SOBRE ASESOR. Pregunta si Atilio/bot puede ayudarlo o por qué lo derivan: "¿me podés ayudar?", "¿vos no me podés ayudar?", "¿por qué me derivás?". NO pide hablar con asesor humano ni registrar patente. Responde Inicio (capacidades del bot). PROHIBIDO flujo asesor conversacional.',
      conditionValue: "",
      condition: "",
      conditionFlowId: F.atilio,
    },
    {
      conditionRule:
        'ASESOR / PERSONA HUMANA — PRIORIDAD ALTA. Pide hablar con asesor, agente, persona humana, operador, atención humana, comunicarse con alguien o escalar el reclamo. NO aplica si solo pregunta si tiene caso abierto, si pide cerrar/cerrar caso/resolver conversación, ni si pregunta si Atilio le puede ayudar. Si en el historial ya hay patente/matrícula, número de caso (TCK-, N°) o ticket recién generado: va DIRECTO al flujo asesor/Odoo sin repreguntar patente. Si no hay patente ni caso en historial: también va a asesor para que el backend pida el dato mínimo.',
      conditionValue: "",
      condition: "",
      conditionFlowId: F.asesor,
    },
    {
      conditionRule:
        'GUÍA UNIDADES WARA — PRIORIDAD SOBRE CONSULTA EN VIVO. La intención es ENTENDER o USAR el módulo Unidades de la plataforma (panel de flota, no consulta API): cómo acceder (ícono vehículo), encabezado, grupos, puntos verde/azul/rojo, chevron/ficha expandida, MIS ATAJOS (Historial, Compartir, Configurar unidad, Orden de trabajo), Crear grupo, Mover unidades, flujo del operador. Incluye: "qué significa el punto rojo", "cómo veo el historial", "dónde está MIS ATAJOS", "cómo creo un grupo". PROHIBIDO si pide consultar reporte/estado en vivo, patente que no reporta, último reporte offline, certificado, odómetro o mantenimiento operativo.',
      conditionValue: "",
      condition: "",
      conditionFlowId: F.infoUnidades,
    },
    {
      conditionRule:
        'EMPRESAS EN WARA — El cliente pregunta qué empresas tiene asociadas a su teléfono, cuáles empresas, "qué empresas tengo", lista de empresas. NO es consulta de unidades, flota ni patente.',
      conditionValue: "",
      condition: "",
      conditionFlowId: F.cambiarEmpresa,
    },
    {
      conditionRule:
        "LISTADO / MIS UNIDADES / ÚLTIMO REPORTE (PRIORIDAD SOBRE CERTIFICADO). La intención es CONSULTAR EN VIVO en Wara: listado operativo, último reporte, si reporta, sin reporte, offline, ubicación, ignición o voltaje. PROHIBIDO si el mensaje actual es solo un saludo. PROHIBIDO si solo pregunta cómo usar el módulo Unidades de la plataforma (MIS ATAJOS, grupos, ficha, puntos de color). PROHIBIDO si solo pide certificado de cobertura.",
      conditionValue: "",
      condition: "",
      conditionFlowId: F.ejecutarConsulta,
    },
    {
      conditionRule:
        "La intención del cliente es AJUSTAR / CORREGIR / ACTUALIZAR el odómetro, horómetro o kilometraje de una unidad; o está aportando o corrigiendo datos de ese trámite que ya viene en curso según el contexto reciente. Cuando el tema es odómetro/kilometraje, esta intención SIEMPRE gana por sobre 'reclamo/asesor'. No aplica cuando es solo una confirmación breve a un resumen ya propuesto.",
      conditionValue: "",
      condition: "",
      conditionFlowId: F.odometer,
    },
    {
      conditionRule:
        "CONSULTAR ESTADO / REPORTE DE UNIDAD (DIRECTO). La intención es conocer información que se resuelve consultando Wara AHORA: último reporte, si está reportando, sin reporte, unidad offline, ubicación, ignición o voltaje. Si la patente está en el mensaje actual se consulta esa unidad; si falta en el mensaje, el sistema lista o pide patente. PROHIBIDO si el mensaje actual es solo un saludo (aunque haya patente en historial). PROHIBIDO si el cliente dice que la ubicación es incorrecta o reporta falla física/hardware (va a Atilio).",
      conditionValue: "",
      condition: "",
      conditionFlowId: F.ejecutarConsulta,
    },
    {
      conditionRule:
        "Por CONTEXTO: en el turno anterior Atilio propuso hacer una CONSULTA DE ESTADO de una unidad concreta y preguntó si avanzaba, y ahora el cliente da el visto bueno para ejecutarla.",
      conditionValue: "",
      condition: "",
      conditionFlowId: F.consultarUnidad,
    },
    {
      conditionRule:
        "La intención del cliente es OBTENER o SOLICITAR un certificado de cobertura / monitoreo / constancia para una unidad o patente, o reenviar un certificado ya emitido. PROHIBIDO si el mensaje dice que NO necesita certificado, pide listado/mis unidades/último reporte, o es solo confirmación (CONFIRMO/sí/dale) después de un resumen de certificado.",
      conditionValue: "",
      condition: "",
      conditionFlowId: F.certificados,
    },
    {
      conditionRule:
        'GUÍA OPCIONES WARA — PRIORIDAD SOBRE MANTENIMIENTO Y CONSULTA. La intención es ENTENDER o CONFIGURAR el módulo Opciones (Agenda, contactos, Perfiles, permisos, Notificaciones, alertas, alarmas, destinos, eventos). Incluye: "cómo agrego/añado un contacto", "cómo configuro una notificación/alerta/alarma", "no me llega el mail/la alerta", "qué es un perfil", "dónde está la agenda". PROHIBIDO si pide ejecutar odómetro, certificado, consulta de unidad/reporte en vivo, mantenimiento operativo real o ticket/reclamo. PROHIBIDO si solo pregunta cómo funciona el módulo de mantenimiento.',
      conditionValue: "",
      condition: "",
      conditionFlowId: F.infoOpciones,
    },
    {
      conditionRule:
        "La intención del cliente es REGISTRAR o PROGRAMAR una gestión operativa real de mantenimiento ahora (tarea, correctivo, preventivo, plan, neumáticos/RFID). Incluye frases como «quiero programar mantenimiento», «necesito registrar un correctivo», «abrir tarea de mantenimiento». PROHIBIDO si solo pregunta cómo usar o configurar el módulo. PROHIBIDO si pregunta por Agenda, contactos, Perfiles o Notificaciones de Opciones. PROHIBIDO si el historial reciente ya contiene una guía de Opciones respondida (Agenda/contactos/notificaciones) y no hay pedido operativo nuevo.",
      conditionValue: "",
      condition: "",
      conditionFlowId: F.gestionMaint,
    },
    {
      conditionRule:
        "La intención del cliente es ENTENDER cómo funciona el módulo de mantenimiento (guía informativa, sin patente ni ticket). PROHIBIDO si dice quiero/necesito/programar/registrar mantenimiento o quiere abrir un caso real. PROHIBIDO si es guía de Opciones (Agenda, contactos, notificaciones, perfiles).",
      conditionValue: "",
      condition: "",
      conditionFlowId: F.infoMaint,
    },
    {
      conditionRule:
        "ATILIO / DEFAULT. Saludos, consultas generales y primer planteo de problema que NO sea servicio automático ni falta de reporte consultable. Si falta patente, pedí SOLO la patente. Para GPS sin reporte, NO hagas preguntas técnicas: va al flujo de consulta de unidad. Ante ambigüedad, va acá primero.",
      conditionValue: "",
      condition: "",
      conditionFlowId: F.atilio,
    },
  ];
}

async function main() {
  const { key, sseUrl } = loadMcp();
  const transport = new SSEClientTransport(new URL(sseUrl), {
    requestInit: { headers: { "x-builderbot-api-key": key } },
  });
  const client = new Client({ name: "sync-router-wara", version: "1.0.0" });
  await client.connect(transport);

  const result = await client.callTool({
    name: "builderbot_update_answer",
    arguments: {
      projectId: PROJECT_ID,
      flowId: FLOW_ID,
      answerId: ANSWER_ID,
      type: "add_intent",
      plugins: { intent: { rules: buildRules() } },
    },
  });
  console.log("Router OK", JSON.stringify(result.content ?? result));
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
