import { NextResponse } from "next/server";
import { authorizeKpiApi } from "@/lib/kpiApiAuth";
import { KPI_CATALOGS } from "@/lib/kpiDashboard";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/kpi/catalogs
 * Valores vigentes de enums para el dashboard (sin hardcode).
 */
export async function GET(req: Request) {
  const auth = authorizeKpiApi(req);
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    data: KPI_CATALOGS,
    meta: { readOnly: true, timezone: "UTC" },
  });
}
