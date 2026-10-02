/**
 * Takeover humano — V2 no responde si botPausedAt activo en mesa lab.
 */
import { fetchCustomerBotPauseStatus } from "./v1-bridge-client.js";

export async function isV2BlockedByHumanTakeover(input: {
  phone: string;
  tenantId: string;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const env = input.env ?? process.env;
  if (env.WARA_V2_V1_TICKET_BRIDGE_ENABLED !== "true") return false;
  const { botPaused } = await fetchCustomerBotPauseStatus(input.phone, input.tenantId, env);
  return botPaused;
}

/** Mensaje silencioso cuando un humano tiene el control. */
export const HUMAN_TAKEOVER_SILENT = "";
