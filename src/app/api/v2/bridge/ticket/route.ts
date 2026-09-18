import { NextResponse } from "next/server";
import { z } from "zod";
import {
  assertV2BridgeApiKey,
  validateBridgeGates,
} from "@/lib/v2Bridge/gates";
import { createLabTicketFromV2Bridge } from "@/lib/v2Bridge/createLabTicket";

const bodySchema = z.object({
  phoneE164: z.string().min(8),
  tenantId: z.string().min(1),
  contactName: z.string().min(1),
  companyName: z.string().nullable().optional(),
  title: z.string().min(1),
  messageText: z.string().min(1),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  category: z.enum(["TECH_SUPPORT", "BILLING", "SALES", "OTHER"]).optional(),
  operationId: z.string().uuid(),
  payloadHash: z.string().min(8),
  tramite: z.string().min(1),
  operationStatus: z.string().min(1),
  externalResult: z.string().nullable().optional(),
  unknownOutcome: z.boolean().optional(),
  reconciliationRequired: z.boolean().optional(),
  collectedData: z.record(z.string(), z.unknown()).optional(),
  derivationReason: z.string().nullable().optional(),
  unit: z
    .object({
      patente: z.string().optional(),
      label: z.string().optional(),
    })
    .nullable()
    .optional(),
});

export async function POST(req: Request) {
  const apiKey = req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!assertV2BridgeApiKey(apiKey)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const gates = validateBridgeGates({
    tenantId: parsed.data.tenantId,
    phoneE164: parsed.data.phoneE164,
  });
  if (!gates.ok) {
    return NextResponse.json({ ok: false, error: gates.error, skipped: true }, { status: 403 });
  }

  const result = await createLabTicketFromV2Bridge(parsed.data);
  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}
