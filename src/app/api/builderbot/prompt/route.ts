import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/apiAuth";
import { composePrompt, extractCustomPrompt, hasTemplateMarkers } from "@/lib/promptTemplate";

const BUILDERBOT_API_URL = process.env.BUILDERBOT_API_URL || "https://app.builderbot.cloud";
const BOT_ID = process.env.BUILDERBOT_BOT_ID || "";
const API_KEY = process.env.BUILDERBOT_API_KEY || "";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  if (!BOT_ID || !API_KEY) {
    const fullContent = composePrompt("");
    return NextResponse.json(
      {
        content: "",
        fullContent,
        usesTemplate: true,
        updatedAt: new Date().toISOString(),
      },
      { status: 200 }
    );
  }

  try {
    const response = await fetch(`${BUILDERBOT_API_URL}/api/v2/${BOT_ID}/prompt`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-builderbot": API_KEY,
      },
    });

    if (!response.ok) {
      throw new Error("Error fetching prompt");
    }

    const data = await response.json();
    const fullContent = String(data?.content || "");
    return NextResponse.json({
      ...data,
      content: extractCustomPrompt(fullContent),
      fullContent,
      usesTemplate: hasTemplateMarkers(fullContent),
    });
  } catch (error) {
    console.error("Error in GET /api/builderbot/prompt:", error);
    // Retornar prompt por defecto si la API no está disponible
    const fullContent = composePrompt("");
    return NextResponse.json({
      content: "",
      fullContent,
      usesTemplate: true,
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
    const finalPrompt = composePrompt(prompt);

    if (!BOT_ID || !API_KEY) {
      // Si no está configurado, simular éxito
      return NextResponse.json({
        content: prompt,
        fullContent: finalPrompt,
        usesTemplate: true,
        updatedAt: new Date().toISOString(),
      });
    }

    const response = await fetch(`${BUILDERBOT_API_URL}/api/v2/${BOT_ID}/prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-builderbot": API_KEY,
      },
      body: JSON.stringify({ content: finalPrompt }),
    });

    if (!response.ok) {
      throw new Error("Error saving prompt");
    }

    const data = await response.json();
    return NextResponse.json({
      ...data,
      content: prompt,
      fullContent: String(data?.content || finalPrompt),
      usesTemplate: hasTemplateMarkers(String(data?.content || finalPrompt)),
    });
  } catch (error: any) {
    console.error("Error in POST /api/builderbot/prompt:", error);
    // Simular éxito si la API no está disponible
    const finalPrompt = composePrompt(prompt);
    return NextResponse.json({
      content: prompt,
      fullContent: finalPrompt,
      usesTemplate: true,
      updatedAt: new Date().toISOString(),
    });
  }
}
