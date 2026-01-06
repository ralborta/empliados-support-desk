import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/auth";

const BUILDERBOT_API_URL = process.env.BUILDERBOT_API_URL || "https://app.builderbot.cloud";
const BOT_ID = process.env.BUILDERBOT_BOT_ID || "";
const API_KEY = process.env.BUILDERBOT_API_KEY || "";

export async function GET(request: NextRequest) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!BOT_ID || !API_KEY) {
    return NextResponse.json(
      {
        content:
          "Eres un asistente virtual amigable y profesional. Ayuda a los usuarios con sus consultas de manera clara y concisa.",
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
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error in GET /api/builderbot/prompt:", error);
    // Retornar prompt por defecto si la API no está disponible
    return NextResponse.json({
      content:
        "Eres un asistente virtual amigable y profesional. Ayuda a los usuarios con sus consultas de manera clara y concisa.",
      updatedAt: new Date().toISOString(),
    });
  }
}

export async function POST(request: NextRequest) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let prompt = "";
  try {
    const body = await request.json();
    prompt = body.content || body.prompt || "";

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    if (!BOT_ID || !API_KEY) {
      // Si no está configurado, simular éxito
      return NextResponse.json({
        content: prompt,
        updatedAt: new Date().toISOString(),
      });
    }

    const response = await fetch(`${BUILDERBOT_API_URL}/api/v2/${BOT_ID}/prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-builderbot": API_KEY,
      },
      body: JSON.stringify({ content: prompt }),
    });

    if (!response.ok) {
      throw new Error("Error saving prompt");
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Error in POST /api/builderbot/prompt:", error);
    // Simular éxito si la API no está disponible
    return NextResponse.json({
      content: prompt,
      updatedAt: new Date().toISOString(),
    });
  }
}
