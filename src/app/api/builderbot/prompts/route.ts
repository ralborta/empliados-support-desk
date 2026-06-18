import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/apiAuth";
import { listBotPromptModules } from "@/lib/botPromptStore";

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    const modules = await listBotPromptModules();
    return NextResponse.json({ modules });
  } catch (error) {
    console.error("GET /api/builderbot/prompts:", error);
    return NextResponse.json({ error: "No se pudieron cargar los prompts por módulo" }, { status: 500 });
  }
}
