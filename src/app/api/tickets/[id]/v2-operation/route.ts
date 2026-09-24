import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { prisma } from "@/lib/db";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { assertAdvisorCanAccessTicket } from "@/lib/advisorDistribution";
import { extractLatestV2OperationFromMessages } from "@/lib/v2Bridge/createLabTicket";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const allowed = await assertAdvisorCanAccessTicket(id, session.user);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const messages = await prisma.ticketMessage.findMany({
    where: { ticketId: id },
    orderBy: { createdAt: "asc" },
    select: { rawPayload: true, createdAt: true },
  });

  const operation = extractLatestV2OperationFromMessages(messages);
  if (!operation) {
    return NextResponse.json({ hasV2Operation: false });
  }

  return NextResponse.json({
    hasV2Operation: true,
    operation: {
      tramite: operation.tramite,
      unit: operation.unit,
      operationId: operation.operationId,
      operationIdShort: operation.operationId.slice(0, 8),
      payloadHashShort: operation.payloadHash.slice(0, 12),
      status: operation.operationStatus,
      createdAt: operation.createdAt,
      externalResult: operation.externalResult,
      unknownOutcome: operation.unknownOutcome,
      reconciliationRequired: operation.reconciliationRequired,
      collectedData: operation.collectedData,
      derivationReason: operation.derivationReason,
      tenantId: operation.tenantId,
    },
  });
}
