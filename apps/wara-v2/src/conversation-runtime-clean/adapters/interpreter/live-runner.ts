import { createEmptyCleanState } from "../../core/types/state.js";
import { RuntimeNextStableTransport } from "./runtime-next-stable-transport.js";
import { StableInterpreterAdapter } from "./stable-interpreter-adapter.js";

export async function runCleanInterpreterLive(input: { message: string; env: NodeJS.ProcessEnv }) {
  if (!input.env.OPENAI_API_KEY) return { skipped: true as const, reason: "credential_unavailable" };
  const adapter = new StableInterpreterAdapter(new RuntimeNextStableTransport(input.env));
  const interpretation = await adapter.interpret({ message: input.message, state: createEmptyCleanState({ tenantId: "live-synthetic", conversationId: "live-synthetic" }) });
  return { skipped: false as const, interpretation, diagnostic: adapter.lastDiagnostic };
}
