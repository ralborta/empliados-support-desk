import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/apiAuth";
import { advisorHeartbeat } from "@/lib/advisorDistribution";

export async function POST() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const result = await advisorHeartbeat(auth.session.user!.id);
  return NextResponse.json(result);
}
