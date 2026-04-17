import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { prisma } from "@/lib/db";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { mergeDuplicateOpenTickets } from "@/lib/ticketThreading";

/**
 * POST: une en un solo ticket todos los casos abiertos duplicados por cliente (one-off / mantenimiento).
 * Requiere sesión (operador del panel).
 */
export async function POST() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
