import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/apiAuth";
import { mergeDuplicateOpenTickets } from "@/lib/ticketThreading";

/**
 * POST: une en un solo ticket todos los casos abiertos duplicados por cliente (one-off / mantenimiento).
 * Requiere rol ADMIN.
 */
export async function POST() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    const result = await mergeDuplicateOpenTickets(prisma);
    return NextResponse.json({
      ok: true,
      ...result,
      message:
        result.ticketsMergedAway === 0
          ? "No había tickets abiertos duplicados por cliente."
          : `Se fusionaron ${result.ticketsMergedAway} ticket(s) en ${result.customersProcessed} cliente(s).`,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error al fusionar";
    console.error("[merge-duplicate-open-tickets]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
