import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/apiAuth";
import { advisorHeartbeat, recordAdminPresence } from "@/lib/advisorDistribution";

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const currentPage =
    typeof body?.currentPage === "string" ? body.currentPage : undefined;

  const user = auth.session.user!;
  // ADMIN no participa del reparto de casos (advisorHeartbeat es SUPPORT-only), pero
  // igual necesitamos su presencia para el monitor externo — ver recordAdminPresence.
  const result =
    user.role === "ADMIN"
      ? await recordAdminPresence(user.id, currentPage)
      : await advisorHeartbeat(user.id, currentPage);
  return NextResponse.json(result);
}
