/**
 * API entry — loopback only.
 */
import { applyTestFlags, loadPhase7Flags } from "./flags.js";
import { startApiServer } from "./server.js";

export function describeApi() {
  return {
    service: "wara-v2-api",
    phase: 7,
    listening_default: "127.0.0.1",
    shadow: true,
    delivery_enabled: false,
    note: "Local API for synthetic ingress/shadow/replay. No public bind.",
  };
}

async function main() {
  applyTestFlags();
  loadPhase7Flags();
  if (!process.env.WARA_V2_DATABASE_URL) {
    console.log(JSON.stringify(describeApi(), null, 2));
    return;
  }
  const api = await startApiServer({ port: Number(process.env.PORT ?? 8787) });
  console.log(
    JSON.stringify(
      { ...describeApi(), started: true, baseUrl: api.baseUrl },
      null,
      2,
    ),
  );
  const shutdown = async () => {
    await api.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
