import { NextRequest, NextResponse } from "next/server";
import { requireBuilderBotContextAuth } from "@/lib/builderbotCustomerContext";
import { odooDiagnostics } from "@/lib/odooApi";

/**
 * Diagnóstico de conexión con Odoo.
 * GET /api/odoo/diag  (con x-api-key del contexto, igual que el resto de endpoints internos)
 *
 * Devuelve: estado de config, versión del servidor, uid autenticado y equipos de Helpdesk.
 */
export async function GET(req: NextRequest) {
  const authError = requireBuilderBotContextAuth(req);
  if (authError) return authError;

  const diag = await odooDiagnostics();
  const status = diag.error ? 502 : 200;
  return NextResponse.json(diag, { status });
}
