import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/apiAuth";
import { composePrompt, extractBasePrompt, extractCustomPrompt, hasTemplateMarkers } from "@/lib/promptTemplate";

const BUILDERBOT_API_URL = process.env.BUILDERBOT_API_URL || "https://app.builderbot.cloud";
const BOT_ID = process.env.BUILDERBOT_BOT_ID || "";
const API_KEY = process.env.BUILDERBOT_API_KEY || "";
const ANSWER_ID = process.env.BUILDERBOT_ANSWER_ID || "";

function baseHeaders() {
  return {
    "Content-Type": "application/json",
    "x-api-builderbot": API_KEY,
  };
}

function buildApiV2Base(url: string): string {
  const clean = (url || "").replace(/\/$/, "");
  return clean.endsWith("/api/v2") ? clean : `${clean}/api/v2`;
}

function buildApiLegacyBase(url: string): string {
  return (url || "").replace(/\/$/, "");
}

async function requestAssistantEndpoint(
  method: "GET" | "POST",
  answerId: string,
  payload?: Record<string, unknown>
) {
  const v2Base = buildApiV2Base(BUILDERBOT_API_URL);
  const legacyBase = buildApiLegacyBase(BUILDERBOT_API_URL);
  const v2Url =
    method === "GET"
      ? `${v2Base}/${BOT_ID}/answer/${answerId}`
      : `${v2Base}/${BOT_ID}/answer/${answerId}/plugin/assistant`;
  const legacyUrl =
    method === "GET"
      ? `${legacyBase}/${BOT_ID}/answer/${answerId}`
      : `${legacyBase}/${BOT_ID}/answer/${answerId}/plugin/assistant`;

  const reqInit: RequestInit = {
    method,
    headers: baseHeaders(),
    body: method === "POST" ? JSON.stringify(payload || {}) : undefined,
  };

  const first = await fetch(v2Url, reqInit);
  if (first.ok || first.status !== 404) {
    return { response: first, tried: "v2" as const };
  }
  const second = await fetch(legacyUrl, reqInit);
  return {
    response: second,
    tried: "legacy" as const,
    notFoundInBoth: second.status === 404,
  };
}

function extractAssistantInstructions(payload: any): string {
  return String(
    payload?.instructions ??
      payload?.assistantInstructions ??
      payload?.plugins?.openai?.assistantInstructions ??
      payload?.answer?.plugins?.openai?.assistantInstructions ??
      ""
  );
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  if (!BOT_ID || !API_KEY) {
    return NextResponse.json({ error: "Faltan variables BUILDERBOT_BOT_ID / BUILDERBOT_API_KEY" }, { status: 500 });
  }

  try {
    let fullContent = "";
    let source: "assistant" | "global" = "global";
    let warning: string | null = null;
    let assistantApiUnsupported = false;

    if (ANSWER_ID) {
      const { response: assistantResponse, tried, notFoundInBoth } = await requestAssistantEndpoint("GET", ANSWER_ID);
      if (assistantResponse.ok) {
        const assistantData = await assistantResponse.json();
        fullContent = extractAssistantInstructions(assistantData);
        source = "assistant";
      } else {
        if (notFoundInBoth) {
          assistantApiUnsupported = true;
          warning =
            "Este entorno no soporta lectura de assistant prompt por API. Puedes editar y copiar el prompt final para pegarlo manualmente en BuilderBot.";
        } else {
          warning = `No se pudo leer assistant prompt (${assistantResponse.status}, ruta ${tried}), usando fallback global.`;
        }
      }
    }

    if (!fullContent && !assistantApiUnsupported) {
      const response = await fetch(`${BUILDERBOT_API_URL}/api/v2/${BOT_ID}/prompt`, {
        method: "GET",
        headers: baseHeaders(),
      });
      if (response.ok) {
        const data = await response.json();
        fullContent = String(data?.content || "");
        source = "global";
      } else {
        warning =
          warning ||
          `No se pudo leer prompt global (${response.status}). Se carga bloque editable vacío.`;
      }
    }

    if (!fullContent) {
      fullContent = composePrompt("");
    }

    return NextResponse.json({
      content: extractCustomPrompt(fullContent),
      fullContent,
      usesTemplate: hasTemplateMarkers(fullContent),
      source,
      warning,
      assistantApiUnsupported,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error in GET /api/builderbot/prompt:", error);
    const fullContent = composePrompt("");
    return NextResponse.json({
      content: "",
      fullContent,
      usesTemplate: true,
      source: "global",
      warning: "No se pudo leer BuilderBot. Se cargó un bloque editable vacío para continuar.",
      updatedAt: new Date().toISOString(),
    });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  let prompt = "";
  try {
    const body = await request.json();
    prompt = body.content || body.prompt || "";
    const existingFullContent = typeof body.existingFullContent === "string" ? body.existingFullContent : "";
    const basePromptForCompose = existingFullContent ? extractBasePrompt(existingFullContent) : undefined;
    const finalPrompt = composePrompt(prompt, basePromptForCompose);

    if (!BOT_ID || !API_KEY) {
      return NextResponse.json({ error: "Faltan variables BUILDERBOT_BOT_ID / BUILDERBOT_API_KEY" }, { status: 500 });
    }

    let response: Response;
    let source: "assistant" | "global" = "global";
    if (ANSWER_ID) {
      source = "assistant";
      const assistantReq = await requestAssistantEndpoint("POST", ANSWER_ID, { instructions: finalPrompt });
      if (assistantReq.notFoundInBoth) {
        return NextResponse.json(
          {
            error:
              "Este entorno no soporta actualización del assistant por API. Copia el prompt final y pégalo manualmente en BuilderBot.",
            assistantApiUnsupported: true,
            fullContent: finalPrompt,
            content: prompt,
          },
          { status: 409 }
        );
      }
      response = assistantReq.response;
    } else {
      response = await fetch(`${BUILDERBOT_API_URL}/api/v2/${BOT_ID}/prompt`, {
        method: "POST",
        headers: baseHeaders(),
        body: JSON.stringify({ content: finalPrompt }),
      });
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return NextResponse.json(
        { error: "Error guardando prompt en BuilderBot", details: errorText || response.statusText },
        { status: 502 }
      );
    }

    const data = await response.json();
    return NextResponse.json({
      ...data,
      content: prompt,
      fullContent: finalPrompt,
      usesTemplate: hasTemplateMarkers(finalPrompt),
      source,
    });
  } catch (error) {
    console.error("Error in POST /api/builderbot/prompt:", error);
    return NextResponse.json({ error: "No se pudo guardar el prompt en BuilderBot" }, { status: 502 });
  }
}
