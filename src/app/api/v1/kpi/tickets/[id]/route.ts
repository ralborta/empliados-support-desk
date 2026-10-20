import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeKpiApi, kpiError } from "@/lib/kpiApiAuth";
import {
  KPI_TICKET_INCLUDE,
  mapTicketToKpiDto,
  type TicketForKpi,
} from "@/lib/kpiDashboard";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/kpi/tickets/{id}
 * Detalle de un ticket (mismo objeto que el listado).
 * `id` acepta cuid interno o `code` visible (ej. 09102610).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = authorizeKpiApi(req);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const key = String(id ?? "").trim();
  if (!key) return kpiError("INVALID_ID", "id requerido", 400);

  const ticket = await prisma.ticket.findFirst({
    where: {
      OR: [{ id: key }, { code: key }],
    },
    include: KPI_TICKET_INCLUDE,
  });

  if (!ticket) {
    return kpiError("NOT_FOUND", "Ticket no encontrado", 404);
  }

  return NextResponse.json(mapTicketToKpiDto(ticket as TicketForKpi));
}
