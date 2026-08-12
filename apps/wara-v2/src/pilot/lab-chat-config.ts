/**
 * Configuración del chat lab V2 — teléfono emulado y auth opcional embebida.
 */
import { parseExactPhoneAllowlist } from "../shadow-canary/allowlist.js";

export type LabChatConfig = {
  phone: string;
  tenant: string;
  frontLabUrl: string;
  autoAuth: boolean;
  apiKey: string;
};

function firstAllowlistPhone(env: NodeJS.ProcessEnv): string {
  const explicit = (env.WARA_V2_LAB_CHAT_PHONE ?? "").trim();
  if (explicit && /^\+[1-9]\d{6,14}$/.test(explicit)) return explicit;
  try {
    const list = parseExactPhoneAllowlist(env.WARA_V2_SHADOW_ALLOWLIST ?? "");
    return list[0] ?? "+5491133788190";
  } catch {
    return "+5491133788190";
  }
}

export function getLabChatConfig(env: NodeJS.ProcessEnv = process.env): LabChatConfig {
  const tenant =
    (env.WARA_V2_LAB_CHAT_TENANT ?? env.WARA_V2_SHADOW_TENANT ?? "tenant_internal_ops").trim();
  const autoAuth =
    env.WARA_V2_LAB_CHAT_AUTO_AUTH === "true" || env.WARA_V2_LAB_CHAT_AUTO_AUTH === "1";
  const apiKey =
    autoAuth
      ? (
          env.WARA_V2_TURN_API_KEY?.trim() ||
          env.BUILDERBOT_CONTEXT_API_KEY?.trim() ||
          ""
        )
      : "";

  return {
    phone: firstAllowlistPhone(env),
    tenant,
    frontLabUrl: (
      env.WARA_V2_FRONT_LAB_URL ?? "https://wara-front-v2-lab.wd75db.easypanel.host"
    ).replace(/\/+$/, ""),
    autoAuth: autoAuth && apiKey.length > 0,
    apiKey,
  };
}

export function renderLabChatHtml(template: string, env: NodeJS.ProcessEnv = process.env): string {
  const cfg = getLabChatConfig(env);
  return template
    .replaceAll("__LAB_PHONE__", cfg.phone)
    .replaceAll("__LAB_TENANT__", cfg.tenant)
    .replaceAll("__LAB_FRONT_URL__", cfg.frontLabUrl)
    .replaceAll("__LAB_AUTO_AUTH__", cfg.autoAuth ? "true" : "false")
    .replaceAll("__LAB_API_KEY__", cfg.apiKey);
}
