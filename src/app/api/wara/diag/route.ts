import { NextRequest, NextResponse } from "next/server";
import {
  isCustomerContextAuthConfigured,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";
import {
  getImpersonatedPhone,
  isTestWhitelistEnabled,
  isPhoneAllowedForTesting,
  isWaraEmpresaLookupConfigured,
  obtenerEmpresaPorNumero,
} from "@/lib/waraApi";

/**
 * Diagnóstico TEMPORAL para entender por qué un número resuelve o no en Wara.
 * No expone secretos: solo flags de configuración, conteos y la respuesta cruda
 * (resumida) de ObtenerContactosPorNumero. Borrar cuando termine la depuración.
 *
 * Uso: GET /api/wara/diag?phone=+5491133788190  (con x-api-key)
 */
function keyFromRequest(req: NextRequest): string | undefined {
  return (
    req.headers.get("x-api-key")?.trim() ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    new URL(req.url).searchParams.get("api_key")?.trim() ||
    undefined
  );
}

function envFlag(name: string): { set: boolean; length: number; entries: number } {
  const raw = process.env[name]?.trim() || "";
  return {
    set: raw.length > 0,
    length: raw.length,
    entries: raw ? raw.split(/[,;\n]+/).filter((s) => s.trim()).length : 0,
  };
}

export async function GET(req: NextRequest) {
  if (!isCustomerContextAuthConfigured()) {
    return NextResponse.json({ ok: false, error: "Auth no configurada" }, { status: 503 });
  }
  if (!validateContextSecret(keyFromRequest(req))) {
    return NextResponse.json({ ok: false, error: "API key inválida o faltante" }, { status: 401 });
  }

  const url = new URL(req.url);
  const phone = (url.searchParams.get("phone") ?? "").trim();
  const skipImpersonation =
    url.searchParams.get("raw") === "1" ||
    url.searchParams.get("noimpersonate") === "1";

  const config = {
    waraEmpresaLookupConfigured: isWaraEmpresaLookupConfigured(),
    obtenerEmpresaTokenSet: !!process.env.WARA_OBTENER_EMPRESA_TOKEN?.trim(),
    obtenerEmpresaTokenLength: (process.env.WARA_OBTENER_EMPRESA_TOKEN?.trim() || "").length,
    impersonateMap: envFlag("WARA_TEST_IMPERSONATE_MAP"),
    allowedPhones: envFlag("WARA_TEST_ALLOWED_PHONES"),
    whitelistEnabled: isTestWhitelistEnabled(),
    apiBaseUrlSet: !!process.env.WARA_API_BASE_URL?.trim(),
    apiBaseUrl: process.env.WARA_API_BASE_URL?.trim() || "(default staging)",
  };

  if (!phone) {
    return NextResponse.json({ ok: true, config, hint: "Pasá ?phone=NUMERO para ver el lookup." });
  }

  const impersonation = getImpersonatedPhone(phone);
  const effective = skipImpersonation
    ? impersonation.original
    : impersonation.impersonated
      ? impersonation.effective
      : impersonation.original;

  let lookup: Awaited<ReturnType<typeof obtenerEmpresaPorNumero>> | null = null;
  let lookupError: string | null = null;
  try {
    lookup = await obtenerEmpresaPorNumero(effective);
  } catch (e) {
    lookupError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    ok: true,
    config,
    phoneInput: phone,
    skipImpersonation,
    queriedPhone: effective,
    impersonation: {
      original: impersonation.original,
      effective: impersonation.effective,
      impersonated: impersonation.impersonated,
    },
    allowedForTesting: isPhoneAllowedForTesting(phone),
    lookup: lookup
      ? {
          configured: lookup.configured,
          ok: lookup.ok,
          status: lookup.status,
          encontrado: lookup.encontrado,
          contactosCount: lookup.contactos.length,
          empresas: lookup.contactos.map((c) => c.empresa || c.nombre).slice(0, 5),
          error: lookup.error ?? null,
        }
      : null,
    lookupError,
  });
}
