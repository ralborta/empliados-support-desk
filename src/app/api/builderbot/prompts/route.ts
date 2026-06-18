import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/apiAuth";
import { listBotPromptModules } from "@/lib/botPromptStore";

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    const modules = await listBotPromptModules();
    return NextResponse.json({
      modules,
      assistantApiUnsupported: true,
      syncNote:
        "Los subflujos se guardan en el panel y en scripts/ cuando aplica. La publicación en BuilderBot Cloud sigue siendo manual o vía scripts/sync-builderbot-subflow-prompts.mjs.",
    });
  } catch (error) {
    console.error("GET /api/builderbot/prompts:", error);
    return NextResponse.json({ error: "No se pudieron cargar los prompts por módulo" }, { status: 500 });
  }
}
