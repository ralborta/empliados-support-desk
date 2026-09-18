import { startCleanLabApplication } from "./composition-root.js";

async function main() {
  const application = await startCleanLabApplication(process.env);
  console.log(JSON.stringify({ service: "wara/runtime-clean-lab", runtime: "clean", baseUrl: application.server.baseUrl, deliveryEnabled: application.config.runtime.deliveryEnabled, externalWritesEnabled: application.config.runtime.externalWritesEnabled, commit: application.config.commit }));
  const shutdown = async () => { await application.close(); process.exit(0); };
  process.on("SIGINT", () => void shutdown()); process.on("SIGTERM", () => void shutdown());
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : "CLEAN_STARTUP_FAILED"); process.exit(1); });
