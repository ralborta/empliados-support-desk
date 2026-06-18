import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/apiAuth";
import { getBotPromptModule, saveBotPromptModule } from "@/lib/botPromptStore";

type RouteContext = { params: Promise<{ key: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { key } = await context.params;
  try {
    const module = await getBotPromptModule(key);
    if (!module) {
      return NextResponse.json({ error: "Módulo de prompt no encontrado" }, { status: 404 });
    }
    return NextResponse.json({
      ...module,
    });
  } catch (error) {
    console.error(`GET /api/builderbot/prompts/${key}:`, error);
    return NextResponse.json({ error: "No se pudo cargar el prompt" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { key } = await context.params;
  try {
    const body = await request.json();
    const content = typeof body.content === "string" ? body.content : "";
    const saved = await saveBotPromptModule(key, content);
    if (!saved) {
      return NextResponse.json({ error: "Módulo de prompt no encontrado" }, { status: 404 });
    }
    return NextResponse.json(saved);
  } catch (error) {
    console.error(`POST /api/builderbot/prompts/${key}:`, error);
    return NextResponse.json({ error: "No se pudo guardar el prompt" }, { status: 500 });
  }
}
