/**
 * Persistencia al panel V1 — misma idea que persistCustomerInbound/BotReply.
 * V3 no tiene Prisma V1; reusa el webhook inbound del backend (crea ticket si falta).
 */
function panelBaseUrl(env: NodeJS.ProcessEnv): string {
  return (
    env.WARA_V1_PANEL_BASE_URL?.trim() ||
    env.WARA_V2_BRIDGE_BASE_URL?.trim() ||
    ""
  ).replace(/\/+$/, "");
}

function digitsPhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

async function postInbound(
  base: string,
  eventName: "message.incoming" | "message.outgoing",
  data: Record<string, unknown>,
): Promise<void> {
  await fetch(`${base}/api/whatsapp/inbound`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventName, data }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  }).catch(() => undefined);
}

export async function persistPilotTurnToV1Panel(input: {
  phone: string;
  inboundText: string;
  outboundText: string;
  messageId: string;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const env = input.env ?? process.env;
  const base = panelBaseUrl(env);
  if (!base || base.includes("front-v2-lab")) return;

  const phone = digitsPhone(input.phone);
  if (phone.length < 8) return;

  const inbound = input.inboundText.trim();
  if (inbound) {
    await postInbound(base, "message.incoming", {
      from: phone,
      body: inbound,
      message_id: `v3-in-${input.messageId}`,
    });
  }

  const outbound = input.outboundText.trim();
  if (outbound) {
    await postInbound(base, "message.outgoing", {
      from: phone,
      body: outbound,
      message_id: `v3-out-${input.messageId}`,
    });
  }
}
