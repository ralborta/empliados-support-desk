/** Preferencia de conductor en lab (por teléfono). No toca prod. */

const prefs = new Map<string, "v2" | "v3">();

export function getLabConductorMode(phone: string): "v2" | "v3" {
  return prefs.get(phone) ?? "v2";
}

export function setLabConductorMode(phone: string, mode: "v2" | "v3"): void {
  prefs.set(phone, mode);
}

export function resolveConductorEnabled(
  phone: string,
  env: NodeJS.ProcessEnv,
): boolean {
  if (env.WARA_CONVERSATION_COMMANDER_V3 === "true" || env.WARA_CONVERSATION_COMMANDER_V3 === "1") {
    return true;
  }
  // Lab selector puede forzar V3 sin env global
  if (env.WARA_CONVERSATION_COMMANDER_V3_LAB_OVERRIDE === "true") {
    return getLabConductorMode(phone) === "v3";
  }
  return getLabConductorMode(phone) === "v3";
}
