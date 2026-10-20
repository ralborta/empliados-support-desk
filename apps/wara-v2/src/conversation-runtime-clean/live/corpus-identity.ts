import { stableCleanId } from "../core/identity/stable-id.js";

export function cleanLiveMessageId(input: Readonly<{ runId: string; sessionId: string; caseId: string; turnIndex: number }>): string {
  return stableCleanId("message", [input.runId, input.sessionId, input.caseId, input.turnIndex]);
}
