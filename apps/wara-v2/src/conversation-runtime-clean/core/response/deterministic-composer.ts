import type { Composer } from "../ports/ports.js";
import type { ComposerInput } from "../types/response.js";

export class DeterministicComposer implements Composer {
  async compose(input: ComposerInput): Promise<string> {
    if (input.responsePlan.facts.some((fact) => !fact.verified)) throw new Error("UNVERIFIED_FACT");
    const lines: string[] = [];
    if (input.responsePlan.purpose === "greet") lines.push(input.customerName ? `Hola ${input.customerName}. Soy Atilio.` : "Hola. Soy Atilio.");
    for (const fact of input.responsePlan.facts) lines.push(fact.text);
    if (input.responsePlan.pendingTaskReminder) lines.push(input.responsePlan.pendingTaskReminder);
    if (input.responsePlan.nextQuestion) lines.push(input.responsePlan.nextQuestion);
    if (lines.length === 0) lines.push(input.responsePlan.purpose === "cancel" ? "La tarea quedó cancelada." : "Entendido.");
    return lines.join("\n");
  }
}
