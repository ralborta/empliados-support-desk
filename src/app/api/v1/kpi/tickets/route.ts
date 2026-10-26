import { NextResponse } from "next/server";
import type { Prisma, TicketStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authorizeKpiApi, kpiError } from "@/lib/kpiApiAuth";
import {
  decodeKpiCursor,
  encodeKpiCursor,
  KPI_TICKET_INCLUDE,
  mapTicketToKpiDto,
  type TicketForKpi,
} from "@/lib/kpiDashboard";

export const dynamic = "force-dynamic";

const ESTADO_TO_STATUS: Record<string, TicketStatus> = {
  PENDIENTE: "OPEN",
  EN_PROGRESO: "IN_PROGRESS",
  ESPERANDO_CLIENTE: "WAITING_CUSTOMER",
  RESUELTO: "RESOLVED",
  CERRADO: "CLOSED",
  OPEN: "OPEN",
  IN_PROGRESS: "IN_PROGRESS",
  WAITING_CUSTOMER: "WAITING_CUSTOMER",
  RESOLVED: "RESOLVED",
  CLOSED: "CLOSED",
};

function parseMulti(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * GET /api/v1/kpi/tickets
 * Listado incremental de tickets para dashboard de KPIs (solo lectura).
 */
export async function GET(req: Request) {
  const auth = authorizeKpiApi(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const updatedSince = url.searchParams.get("updatedSince");
  const createdFrom = url.searchParams.get("createdFrom");
  const createdTo = url.searchParams.get("createdTo");
  const asignadoA = url.searchParams.get("asignadoA");
  const modoResolucion = url.searchParams.get("modoResolucion");
  const motivoDerivacion = url.searchParams.get("motivoDerivacion");
  const cursorRaw = url.searchParams.get("cursor");
  const limitRaw = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitRaw)
    ? Math.min(500, Math.max(1, Math.floor(limitRaw)))
    : 100;

  const estadoFilters = parseMulti(url.searchParams.get("estado"));
  const statusIn = estadoFilters
    .map((e) => ESTADO_TO_STATUS[e.toUpperCase()] ?? ESTADO_TO_STATUS[e])
    .filter(Boolean) as TicketStatus[];

  const where: Prisma.TicketWhereInput = {};
  if (updatedSince) {
    const d = new Date(updatedSince);
    if (Number.isNaN(d.getTime())) {
      return kpiError("INVALID_UPDATED_SINCE", "updatedSince inválido (ISO 8601)", 400);
    }
    where.updatedAt = { gte: d };
  }
  if (createdFrom || createdTo) {
    where.createdAt = {};
    if (createdFrom) {
      const d = new Date(createdFrom);
      if (Number.isNaN(d.getTime())) {
        return kpiError("INVALID_CREATED_FROM", "createdFrom inválido (ISO 8601)", 400);
      }
      where.createdAt.gte = d;
    }
    if (createdTo) {
      const d = new Date(createdTo);
      if (Number.isNaN(d.getTime())) {
        return kpiError("INVALID_CREATED_TO", "createdTo inválido (ISO 8601)", 400);
      }
      where.createdAt.lte = d;
    }
  }
  if (statusIn.length) where.status = { in: statusIn };
  if (asignadoA) where.assignedToUserId = asignadoA;

  const cursor = decodeKpiCursor(cursorRaw);
  if (cursorRaw && !cursor) {
    return kpiError("INVALID_CURSOR", "cursor inválido", 400);
  }
  if (cursor) {
    const cursorDate = new Date(cursor.updatedAt);
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      {
        OR: [
          { updatedAt: { gt: cursorDate } },
          { updatedAt: cursorDate, id: { gt: cursor.id } },
        ],
      },
    ];
  }

  const rows = await prisma.ticket.findMany({
    where,
    include: KPI_TICKET_INCLUDE,
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  });

  const page = rows.slice(0, limit) as TicketForKpi[];
  let data = page.map(mapTicketToKpiDto);

  // Filtros que dependen del mapeo (no hay columnas dedicadas aún).
  if (modoResolucion) {
    const wanted = modoResolucion.toUpperCase();
    data = data.filter((t) => t.modoResolucion === wanted);
  }
  if (motivoDerivacion) {
    const wanted = motivoDerivacion.toUpperCase();
    data = data.filter((t) => (t.motivoDerivacion ?? "") === wanted);
  }

  const hasMore = rows.length > limit;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeKpiCursor({ updatedAt: last.updatedAt.toISOString(), id: last.id })
      : null;

  return NextResponse.json({
    data,
    nextCursor,
    meta: {
      limit,
      count: data.length,
      timezone: "UTC",
      readOnly: true,
    },
  });
}
