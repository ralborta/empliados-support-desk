import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

/**
 * Auth de solo lectura para el dashboard de KPIs (credencial distinta del bot).
 * Header: `x-api-key: <KIRA_KPI_API_KEY>` o `Authorization: Bearer <KIRA_KPI_API_KEY>`.
 */
export function extractKpiApiKey(req: Request): string {
  return (
    req.headers.get("x-api-key")?.trim() ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    ""
  );
}

function safeEqualString(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function kpiApiConfigured(): boolean {
  return !!process.env.KIRA_KPI_API_KEY?.trim();
}

export function authorizeKpiApi(req: Request):
  | { ok: true }
  | { ok: false; response: NextResponse } {
  const expected = process.env.KIRA_KPI_API_KEY?.trim() ?? "";
  if (!expected) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          code: "KPI_API_NOT_CONFIGURED",
          message: "KIRA_KPI_API_KEY no configurada en el servidor",
        },
        { status: 503 },
      ),
    };
  }
  const provided = extractKpiApiKey(req);
  if (!provided || !safeEqualString(provided, expected)) {
    return {
      ok: false,
      response: NextResponse.json(
        { code: "UNAUTHORIZED", message: "API key inválida o ausente" },
        { status: 401 },
      ),
    };
  }
  return { ok: true };
}

export function kpiError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ code, message }, { status });
}
