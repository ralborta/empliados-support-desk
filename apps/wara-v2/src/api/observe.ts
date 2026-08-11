/**
 * Observabilidad local sanitizada (Fase 7).
 */
export type ObsEvent = {
  at: string;
  event: string;
  tenant_id: string;
  correlation_id: string;
  causation_id?: string;
  reason_code?: string;
  duration_ms?: number;
  refs?: Record<string, string>;
};

const MAX_REF = 128;
const SENSITIVE = /password|secret|authorization|api[_-]?key|bearer|token|dsn|prompt/i;

export class LocalObserver {
  readonly events: ObsEvent[] = [];
  readonly metrics = new Map<string, number>();

  emit(e: ObsEvent) {
    const clean: ObsEvent = {
      ...e,
      refs: e.refs ? this.sanitizeRefs(e.refs) : undefined,
    };
    this.events.push(clean);
    const key = `${e.event}:${e.reason_code ?? "ok"}`;
    this.metrics.set(key, (this.metrics.get(key) ?? 0) + 1);
  }

  private sanitizeRefs(refs: Record<string, string>) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(refs)) {
      if (SENSITIVE.test(k)) {
        out[k] = "[redacted]";
      } else {
        out[k] = String(v).slice(0, MAX_REF);
      }
    }
    return out;
  }

  snapshot() {
    return {
      events: this.events.slice(-200),
      metrics: Object.fromEntries(this.metrics),
    };
  }
}
