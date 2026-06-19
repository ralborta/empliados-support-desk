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
  asesor: "f75f176c-d0b0-4aa4-a579-6af9c53cb4e0",
  atilio: "e3e7ad1c-27a9-40a8-8556-a24b758a29c6",
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
        'CAMBIAR DE EMPRESA — PRIORIDAD MÁXIMA. Frases: "cambiar empresa", "cambiarme de empresa", "quiero cambiar de empresa", "otra empresa", typos similares. PROHIBIDO si el mensaje es trámite concreto (mantenimiento con detalle, patente, certificado, reporte). La elección 1/2/WARA la procesa Inicio.',
      conditionValue: "",
      condition: "",
      conditionFlowId: F.cambiarEmpresa,
    },
    {
      conditionRule:
        "CONFIRMACIÓN DE ODÓMETRO. Interpretá por CONTEXTO: en el turno anterior el bot resumió un cambio de ODÓMETRO/HORÓMETRO y pidió confirmación, y ahora el cliente acepta/da el visto bueno de cualquier forma natural. Solo aplica si ese último resumen era de odómetro/horómetro; no si era de mantenimiento o certificado.",
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
        'EMPRESAS EN WARA — El cliente pregunta qué empresas tiene asociadas a su teléfono, cuáles empresas, "qué empresas tengo", lista de empresas. NO es consulta de unidades, flota ni patente.',
      conditionValue: "",
      condition: "",
      conditionFlowId: F.cambiarEmpresa,
    },
    {
      conditionRule:
        "LISTADO / MIS UNIDADES / ÚLTIMO REPORTE (PRIORIDAD SOBRE CERTIFICADO). La intención es ver el listado de unidades, todas mis unidades, flota, cuántas unidades tengo, último reporte, estado de reporte, consultar unidad, o dice explícitamente que NO necesita certificado / no quiere certificado. También aplica a 'sin reporte', 'no reporta', ubicación, ignición o voltaje cuando busca información consultable en Wara. PROHIBIDO si solo pide certificado de cobertura.",
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
        "CONSULTAR ESTADO / REPORTE DE UNIDAD (DIRECTO). La intención es conocer información que se resuelve consultando Wara AHORA: último reporte, si está reportando, sin reporte, unidad offline, ubicación, ignición o voltaje. Si la patente está (mensaje o historial) se consulta esa unidad; si falta, el sistema lista o pide patente. El backend valida el tiempo: menor a 1 hora = observación sin ticket; 1 hora o más = caso automático. PROHIBIDO si el cliente dice que la ubicación es incorrecta o reporta falla física/hardware (va a Atilio).",
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
        "La intención del cliente es REGISTRAR o PROGRAMAR una gestión operativa real de mantenimiento ahora (tarea, correctivo, preventivo, plan, neumáticos/RFID). Incluye frases como «quiero programar mantenimiento», «necesito registrar un correctivo», «abrir tarea de mantenimiento». PROHIBIDO si solo pregunta cómo usar o configurar el módulo.",
      conditionValue: "",
      condition: "",
      conditionFlowId: F.gestionMaint,
    },
    {
      conditionRule:
        "La intención del cliente es ENTENDER cómo funciona el módulo de mantenimiento (guía informativa, sin patente ni ticket). PROHIBIDO si dice quiero/necesito/programar/registrar mantenimiento o quiere abrir un caso real.",
      conditionValue: "",
      condition: "",
      conditionFlowId: F.infoMaint,
    },
    {
      conditionRule:
        "ASESOR / TICKET EN ODOO — ÚLTIMO RECURSO Y SOLO CON PATENTE. Aplica SOLO cuando pide explícitamente hablar con una persona/asesor o abrir reclamo formal Y ya hay patente en el historial; o Atilio ya diagnosticó con patente y no hay solución automática. EXCEPCIÓN: falta de reporte va al flujo de consulta de unidad. PROHIBIDO sin patente identificada.",
      conditionValue: "",
      condition: "",
      conditionFlowId: F.asesor,
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
