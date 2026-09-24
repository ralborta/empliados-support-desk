import type { CleanRuntimeConfig } from "../../config/clean-config.js";
import type { Interpreter } from "../../core/ports/ports.js";
export class GatedCleanInterpreter implements Interpreter {
  constructor(private readonly config: CleanRuntimeConfig, private readonly delegate: Interpreter) {}
  interpret(input: Parameters<Interpreter["interpret"]>[0]) { return this.config.runtimeEnabled && this.config.llmEnabled ? this.delegate.interpret(input) : Promise.resolve(null); }
}
