/**
 * Flags fail-closed Fase 7 — shadow / API local.
 * Ausencia o valor inválido ⇒ no arranca.
 */
export type Phase7Flags = {
  SHADOW_MODE: boolean;
  DELIVERY_ENABLED: false;
  V2_MUTATIONS_DISABLED: true;
  ALLOW_EXTERNAL_MUTATIONS: false;
  REAL_MODEL_ENABLED: false;
  REAL_CHANNELS_ENABLED: false;
  BIND_HOST: "127.0.0.1" | "localhost";
};

function reqBool(name: string, expected: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") {
    throw new Error(`flag_missing:${name}`);
  }
  const parsed = v === "true" || v === "1";
  if (parsed !== expected) {
    throw new Error(`flag_invalid:${name}=${v};expected=${expected}`);
  }
  return parsed as true & false;
}

export function loadPhase7Flags(env: NodeJS.ProcessEnv = process.env): Phase7Flags {
  const host = env.WARA_V2_BIND_HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`bind_host_not_loopback:${host}`);
  }
  // Defaults seguros si no hay env en tests: inyectar via applyTestFlags
  const shadow = env.SHADOW_MODE;
  if (shadow !== "true" && shadow !== "1") {
    throw new Error("flag_missing_or_false:SHADOW_MODE");
  }
  reqBool("DELIVERY_ENABLED", false);
  reqBool("V2_MUTATIONS_DISABLED", true);
  reqBool("ALLOW_EXTERNAL_MUTATIONS", false);
  reqBool("REAL_MODEL_ENABLED", false);
  reqBool("REAL_CHANNELS_ENABLED", false);

  return {
    SHADOW_MODE: true,
    DELIVERY_ENABLED: false,
    V2_MUTATIONS_DISABLED: true,
    ALLOW_EXTERNAL_MUTATIONS: false,
    REAL_MODEL_ENABLED: false,
    REAL_CHANNELS_ENABLED: false,
    BIND_HOST: host as "127.0.0.1" | "localhost",
  };
}

/** Solo para harness de test — no usar en producción. */
export function applyTestFlags(): void {
  process.env.SHADOW_MODE = "true";
  process.env.DELIVERY_ENABLED = "false";
  process.env.V2_MUTATIONS_DISABLED = "true";
  process.env.ALLOW_EXTERNAL_MUTATIONS = "false";
  process.env.REAL_MODEL_ENABLED = "false";
  process.env.REAL_CHANNELS_ENABLED = "false";
  process.env.WARA_V2_BIND_HOST = "127.0.0.1";
}
