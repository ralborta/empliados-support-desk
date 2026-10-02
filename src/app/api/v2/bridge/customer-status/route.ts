import { NextResponse } from "next/server";
import { assertV2BridgeApiKey, validateBridgeGates } from "@/lib/v2Bridge/gates";
import { getCustomerBotPauseStatus } from "@/lib/v2Bridge/createLabTicket";

export async function GET(req: Request) {
  const apiKey = req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!assertV2BridgeApiKey(apiKey)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const phone = url.searchParams.get("phone")?.trim();
  const tenantId = (url.searchParams.get("tenantId") ?? "tenant_internal_ops").trim();
  if (!phone) {
    return NextResponse.json({ ok: false, error: "phone_required" }, { status: 400 });
  }

  const gates = validateBridgeGates({ tenantId, phoneE164: phone });
  if (!gates.ok) {
    return NextResponse.json({ ok: false, error: gates.error }, { status: 403 });
  }

  const status = await getCustomerBotPauseStatus(phone);
  return NextResponse.json({ ok: true, ...status });
}
