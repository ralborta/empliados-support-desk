import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * El dominio del monitor externo de presencia (monitor.nivel41.com) debe mostrar
 * directamente /monitor en la raíz, sin exponer el resto de las rutas del panel bajo
 * ese dominio. Solo reescribe "/" — cualquier otra ruta (incluido /api/*) sigue
 * exactamente igual que antes, en cualquier dominio.
 */
const MONITOR_HOST = "monitor.nivel41.com";

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") || "";
  if (host.startsWith(MONITOR_HOST)) {
    const url = req.nextUrl.clone();
    url.pathname = "/monitor";
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/",
};
