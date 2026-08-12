/**
 * Detecta intentos de reclasificación legacy (looksLike* / includes sobre el mensaje del usuario)
 * mientras el cerebro unificado gobierna el turno.
 */
import { AsyncLocalStorage } from "node:async_hooks";

type UnifiedCtx = {
  originalMessageNorm: string;
  decisionAction: string;
  decisionIntent: string;
  attempted: boolean;
  reasons: string[];
};

// Una sola instancia aunque tsx/ESM cargue el módulo más de una vez.
const g = globalThis as typeof globalThis & {
  __waraV2UnifiedBrainAls?: AsyncLocalStorage<UnifiedCtx>;
};
const als: AsyncLocalStorage<UnifiedCtx> =
  g.__waraV2UnifiedBrainAls ?? (g.__waraV2UnifiedBrainAls = new AsyncLocalStorage<UnifiedCtx>());

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function runWithUnifiedBrainContext<T>(
  input: { originalMessage: string; decisionAction: string; decisionIntent: string },
  fn: () => Promise<T>,
): Promise<T> {
  const store: UnifiedCtx = {
    originalMessageNorm: norm(input.originalMessage),
    decisionAction: input.decisionAction,
    decisionIntent: input.decisionIntent,
    attempted: false,
    reasons: [],
  };
  return als.run(store, fn);
}

export function noteLegacyTextReclassification(reason: string, text?: string | null): void {
  const ctx = als.getStore();
  if (!ctx) return;
  const n = norm(String(text ?? ""));
  // Solo cuenta si se está re-leyendo el mensaje original del usuario.
  if (!n || n !== ctx.originalMessageNorm) return;
  ctx.attempted = true;
  if (ctx.reasons.length < 8) ctx.reasons.push(reason.slice(0, 80));
}

export function getLegacyReclassAttempt(): {
  attempted: boolean;
  reasons: string[];
} {
  const ctx = als.getStore();
  if (!ctx) return { attempted: false, reasons: [] };
  return { attempted: ctx.attempted, reasons: ctx.reasons.slice() };
}

export function isInsideUnifiedBrainContext(): boolean {
  return Boolean(als.getStore());
}
