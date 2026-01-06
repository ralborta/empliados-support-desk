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
      { error: "BuilderBot no configurado", files: [] },
      { status: 503 }
    );
  }

  try {
    // Intentar obtener archivos desde BuilderBot API
    // Nota: Ajusta la URL según la API real de BuilderBot
    const response = await fetch(`${BUILDERBOT_API_URL}/api/v2/${BOT_ID}/files`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-builderbot": API_KEY,
      },
    });

    if (!response.ok) {
      throw new Error("Error fetching files");
    }

    const data = await response.json();
    return NextResponse.json({ files: data.files || data || [] });
  } catch (error) {
    console.error("Error in GET /api/builderbot/files:", error);
    // Retornar array vacío si la API no está disponible
    return NextResponse.json({ files: [] });
  }
}

export async function POST(request: NextRequest) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!BOT_ID || !API_KEY) {
    return NextResponse.json(
      { error: "BuilderBot no configurado" },
      { status: 503 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validar tamaño (máximo 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "El archivo es demasiado grande. Máximo 10MB" },
        { status: 400 }
      );
    }

    const uploadFormData = new FormData();
    uploadFormData.append("file", file);

    // Subir archivo a BuilderBot
    const response = await fetch(`${BUILDERBOT_API_URL}/api/v2/${BOT_ID}/files`, {
      method: "POST",
      headers: {
        "x-api-builderbot": API_KEY,
      },
      body: uploadFormData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Error uploading file: ${errorText}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Error in POST /api/builderbot/files:", error);
    return NextResponse.json(
      { error: error.message || "Error uploading file" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!BOT_ID || !API_KEY) {
    return NextResponse.json(
      { error: "BuilderBot no configurado" },
      { status: 503 }
    );
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const fileId = searchParams.get("id");

    if (!fileId) {
      return NextResponse.json({ error: "File ID is required" }, { status: 400 });
    }

    const response = await fetch(`${BUILDERBOT_API_URL}/api/v2/${BOT_ID}/files/${fileId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "x-api-builderbot": API_KEY,
      },
    });

    if (!response.ok) {
      throw new Error("Error deleting file");
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error in DELETE /api/builderbot/files:", error);
    return NextResponse.json(
      { error: error.message || "Error deleting file" },
      { status: 500 }
    );
  }
}
