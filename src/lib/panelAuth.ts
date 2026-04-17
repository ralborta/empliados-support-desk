import { timingSafeEqual } from "crypto";
import type { SessionUser } from "@/lib/auth";

/**
 * Credenciales del panel vía variables de entorno (no commitear contraseñas).
 *
 * PANEL_USER_WARA_EMAIL + PANEL_USER_WARA_PASSWORD → rol SUPPORT (mesa / test cliente)
 * PANEL_USER_ADMIN_EMAIL + PANEL_USER_ADMIN_PASSWORD → rol ADMIN
 */
/** Al menos una cuenta completa (email + password) por pareja. Podés definir solo admin o solo Wara. */
export function panelAuthConfigured(): boolean {
  const waraOk =
    !!process.env.PANEL_USER_WARA_EMAIL?.trim() && !!process.env.PANEL_USER_WARA_PASSWORD;
  const adminOk =
    !!process.env.PANEL_USER_ADMIN_EMAIL?.trim() && !!process.env.PANEL_USER_ADMIN_PASSWORD;
  return waraOk || adminOk;
}

/** Texto para mensajes de error (sin exponer secretos). */
export function panelAuthMissingDescription(): string {
  const waraOk =
    !!process.env.PANEL_USER_WARA_EMAIL?.trim() && !!process.env.PANEL_USER_WARA_PASSWORD;
  const adminOk =
    !!process.env.PANEL_USER_ADMIN_EMAIL?.trim() && !!process.env.PANEL_USER_ADMIN_PASSWORD;
  if (waraOk || adminOk) return "";
  return (
    "Definí al menos una cuenta en Vercel (Settings → Environment Variables): " +
    "pareja Wara (PANEL_USER_WARA_EMAIL + PANEL_USER_WARA_PASSWORD) y/o " +
    "pareja admin (PANEL_USER_ADMIN_EMAIL + PANEL_USER_ADMIN_PASSWORD). Luego redeploy."
  );
}

function safeEqualString(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function tryPanelLogin(emailRaw: string, password: string): SessionUser | null {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !password) return null;

  const wEmail = process.env.PANEL_USER_WARA_EMAIL?.trim().toLowerCase();
  const wPass = process.env.PANEL_USER_WARA_PASSWORD;
  if (wEmail && wPass && email === wEmail && safeEqualString(wPass, password)) {
    return {
      id: "panel-wara",
      email: wEmail,
      name: "Wara",
      role: "SUPPORT",
    };
  }

  const aEmail = process.env.PANEL_USER_ADMIN_EMAIL?.trim().toLowerCase();
  const aPass = process.env.PANEL_USER_ADMIN_PASSWORD;
  if (aEmail && aPass && email === aEmail && safeEqualString(aPass, password)) {
    return {
      id: "panel-admin",
      email: aEmail,
      name: "Administración",
      role: "ADMIN",
    };
  }

  return null;
}
