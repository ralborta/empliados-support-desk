export type WaraHealthStage =
  | "ok"
  | "network_error"
  | "token_invalid"
  | "misconfigured"
  | "wrong_environment";

export type WaraHealthStatus = {
  healthy: boolean;
  stage: WaraHealthStage;
  message: string;
  apiBaseUrl: string;
  isStagingUrl: boolean;
  configWarning?: string;
  checkedAt: string;
  httpStatus?: number;
};

function waraApiBaseUrl(): string {
  return (
    process.env.WARA_API_BASE_URL?.trim() ||
    process.env.WARA_MAINTENANCE_API_BASE_URL?.trim() ||
    "https://apps.visionblo.com/rb/app/api_interna"
  ).replace(/\/+$/, "");
}

/** Probe liviano: ¿Wara responde en la URL configurada? */
export async function checkWaraApiHealth(): Promise<WaraHealthStatus> {
  const apiBaseUrl = waraApiBaseUrl();
  const token = process.env.WARA_OBTENER_EMPRESA_TOKEN?.trim() || "";
  const checkedAt = new Date().toISOString();
  const isStagingUrl = /staging\.visionblo\.com/i.test(apiBaseUrl);

  if (!token) {
    return {
      healthy: false,
      stage: "misconfigured",
      message: "Falta WARA_OBTENER_EMPRESA_TOKEN en el entorno.",
      apiBaseUrl,
      isStagingUrl,
      checkedAt,
    };
  }

  if (isStagingUrl && process.env.VERCEL_ENV === "production") {
    // Seguimos probando conectividad; la advertencia va en configWarning.
  }

  try {
    const res = await fetch(`${apiBaseUrl}/ObtenerContactosPorNumero`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, telefono: "5491100000000" }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const waraError = typeof json?.error === "string" ? json.error : "";

    if (/token inv[aá]lid/i.test(waraError)) {
      return {
        healthy: false,
        stage: "token_invalid",
        message: `Wara respondió pero rechazó el token (${apiBaseUrl}).`,
        apiBaseUrl,
        isStagingUrl,
        checkedAt,
        httpStatus: res.status,
      };
    }

    if (res.status >= 500) {
      return {
        healthy: false,
        stage: "network_error",
        message: `Wara respondió HTTP ${res.status}.`,
        apiBaseUrl,
        isStagingUrl,
        checkedAt,
        httpStatus: res.status,
      };
    }

    return {
      healthy: true,
      stage: "ok",
      message: isStagingUrl
        ? "Wara staging responde."
        : "Wara producción responde.",
      apiBaseUrl,
      isStagingUrl,
      configWarning:
        isStagingUrl && process.env.VERCEL_ENV === "production"
          ? "Producción usa URL de staging; conviene apps.visionblo.com en prod."
          : undefined,
      checkedAt,
      httpStatus: res.status,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      healthy: false,
      stage: "network_error",
      message: detail.includes("fetch failed")
        ? `No se pudo conectar a Wara (${apiBaseUrl}): fetch failed.`
        : `No se pudo conectar a Wara: ${detail}`,
      apiBaseUrl,
      isStagingUrl,
      checkedAt,
    };
  }
}
