/**
 * Live real (OpenAI): el agente elige guia_informativa sin ejecutar tools ni escrituras.
 *
 * Uso:
 *   OPENAI_API_KEY=... npx tsx --test src/lib/atilioAgent.maintenance.live.test.ts
 *
 * No llama info-guides/route ni Odoo: solo completion + tool_calls.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import OpenAI from "openai";
import { buildAtilioAgentTools } from "./atilioAgentTools";
import { shouldRequireMaintenanceGuideTool } from "./atilioAgent";

const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
const hasLive = Boolean(apiKey);

const MAINT_OFF_SYSTEM = `Sos Kira por WhatsApp. Mantenimiento operativo por WhatsApp está DESHABILITADO.
Si el cliente habla de mantenimiento / preventivo / correctivo / cómo cargar en Wara → llamá guia_informativa.
Si pide certificado, GPS, odómetro o cambiar empresa → NO uses guia_informativa de mantenimiento; usá la tool que corresponda (certificado_cobertura, consultar_unidades, registrar_odometro_horometro) o preguntá sin inventar trámite de mantenimiento.
Nunca inventes programar mantenimiento por chat.`;

async function firstToolName(userMessage: string, threadTail = ""): Promise<string | null> {
  const openai = new OpenAI({ apiKey });
  const tools = buildAtilioAgentTools(false);
  const completion = await openai.chat.completions.create({
    model: process.env.WARA_AGENT_MODEL?.trim() || "gpt-4o-mini",
    messages: [
      { role: "system", content: MAINT_OFF_SYSTEM },
      {
        role: "user",
        content: [
          threadTail ? `=== HISTORIAL ===\n${threadTail}\n` : "",
          "=== MENSAJE ACTUAL ===",
          userMessage,
          shouldRequireMaintenanceGuideTool({
            selectionText: userMessage,
            threadText: threadTail,
            operativeEnabled: false,
          })
            ? "\n(requiere_guia_mantenimiento: true — llamá guia_informativa)"
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    tools: tools as OpenAI.Chat.Completions.ChatCompletionTool[],
    tool_choice: shouldRequireMaintenanceGuideTool({
      selectionText: userMessage,
      threadText: threadTail,
      operativeEnabled: false,
    })
      ? { type: "function", function: { name: "guia_informativa" } }
      : "auto",
    temperature: 0,
    max_tokens: 80,
  });
  const call = completion.choices[0]?.message?.tool_calls?.[0];
  if (!call || call.type !== "function") return null;
  return call.function.name;
}

describe("live maintenance agent → guia_informativa (sin escrituras)", () => {
  it(
    "Mantenimiento → tool guia_informativa",
    { skip: !hasLive },
    async () => {
      const name = await firstToolName("Mantenimiento");
      assert.equal(name, "guia_informativa");
    },
  );

  it(
    "¿Cómo cargo el preventivo? → guia_informativa",
    { skip: !hasLive },
    async () => {
      const name = await firstToolName("¿Cómo cargo el preventivo?");
      assert.equal(name, "guia_informativa");
    },
  );

  it(
    "No pude cargar el mantenimiento → guia_informativa",
    { skip: !hasLive },
    async () => {
      const name = await firstToolName("No pude cargar el mantenimiento");
      assert.equal(name, "guia_informativa");
    },
  );

  it(
    "tras guía, Quiero un certificado → NO guia_informativa",
    { skip: !hasLive },
    async () => {
      const thread =
        "El modulo de mantenimiento\nOrientacion de uso como guia general.\nUtilidades → Mantenimiento.";
      assert.equal(
        shouldRequireMaintenanceGuideTool({
          selectionText: "Quiero un certificado",
          threadText: thread,
          operativeEnabled: false,
        }),
        false,
      );
      const name = await firstToolName("Quiero un certificado", thread);
      assert.notEqual(name, "guia_informativa");
    },
  );

  it(
    "tras guía, Revisá el GPS → NO guia_informativa",
    { skip: !hasLive },
    async () => {
      const thread =
        "El modulo de mantenimiento\nOrientacion de uso como guia general.\nUtilidades → Mantenimiento.";
      const name = await firstToolName("Revisá el GPS de la unidad", thread);
      assert.notEqual(name, "guia_informativa");
    },
  );
});
