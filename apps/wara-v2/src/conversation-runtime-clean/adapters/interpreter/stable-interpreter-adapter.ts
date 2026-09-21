import type { Interpreter } from "../../core/ports/ports.js";
import type { TurnInterpretation } from "../../core/types/interpretation.js";
import type { ConversationStateClean } from "../../core/types/state.js";
import { mapStableInterpretation } from "./stable-output-mapper.js";

export interface StableInterpreterTransport {
  call(input: { message: string; state: ConversationStateClean }): Promise<unknown>;
}
export type CleanInterpreterDiagnostic = Readonly<{ ok: boolean; code: "mapped" | "invalid_output" | "transport_error" }>;

export class StableInterpreterAdapter implements Interpreter {
  lastDiagnostic: CleanInterpreterDiagnostic | null = null;
  constructor(private readonly transport: StableInterpreterTransport) {}
  async interpret(input: { message: string; state: ConversationStateClean }): Promise<TurnInterpretation | null> {
    try {
      const raw = await this.transport.call(input);
      const interpretation = mapStableInterpretation(raw, input.state);
      this.lastDiagnostic = interpretation ? { ok: true, code: "mapped" } : { ok: false, code: "invalid_output" };
      return interpretation;
    } catch {
      this.lastDiagnostic = { ok: false, code: "transport_error" };
      return null;
    }
  }
}
