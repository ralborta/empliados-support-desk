import type { ComposerLlmTransport, ComposerStyleEnvelope } from "../composer/facts-only-composer.js";
import type { SingleRequestTransport } from "../services/guarded-http-transport.js";

export type JsonTransportConfig = Readonly<{ baseUrl: string; headers: Readonly<Record<string, string>> }>;
function endpoint(baseUrl: string, path: string): string { return `${baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl}${path.startsWith("/") ? path : `/${path}`}`; }
async function jsonRequest(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const value: unknown = await response.json().catch(() => ({}));
  if (!response.ok) return { statusCode: response.status, ...(value && typeof value === "object" && !Array.isArray(value) ? value : {}) };
  return value;
}
export function createJsonServiceTransport(config: JsonTransportConfig): SingleRequestTransport {
  return async (input) => jsonRequest(endpoint(config.baseUrl, input.path), { method: "POST", headers: { "content-type": "application/json", "x-correlation-id": input.correlationId, "x-tenant-id": input.tenantId, ...config.headers }, body: JSON.stringify(input.body ?? {}) }, input.timeoutMs);
}
export class OpenAiFactsOnlyComposerTransport implements ComposerLlmTransport {
  constructor(private readonly apiKey: string, private readonly model: string) {}
  async compose(input: Parameters<ComposerLlmTransport["compose"]>[0]): Promise<ComposerStyleEnvelope> {
    const response = await jsonRequest("https://api.openai.com/v1/responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` }, body: JSON.stringify({ model: this.model, input: [{ role: "system", content: "Return JSON only. Choose concise opening/closing style and factOrder using every supplied fact code exactly once. Never rewrite facts." }, { role: "user", content: JSON.stringify(input) }], text: { format: { type: "json_schema", name: "clean_composer", strict: true, schema: { type: "object", additionalProperties: false, properties: { opening: { type: "string" }, factOrder: { type: "array", items: { type: "string" } }, closing: { type: "string" } }, required: ["opening", "factOrder", "closing"] } } } }) }, 30_000) as { output_text?: unknown; output?: Array<{ content?: Array<{ text?: unknown }> }> };
    const text = typeof response.output_text === "string" ? response.output_text : response.output?.flatMap((item) => item.content ?? []).find((item) => typeof item.text === "string")?.text;
    if (typeof text !== "string") throw new Error("clean_composer_invalid_response");
    const parsed: unknown = JSON.parse(text); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("clean_composer_invalid_json");
    const value = parsed as { opening?: unknown; factOrder?: unknown; closing?: unknown };
    if (typeof value.opening !== "string" || !Array.isArray(value.factOrder) || value.factOrder.some((item) => typeof item !== "string") || typeof value.closing !== "string") throw new Error("clean_composer_invalid_schema");
    return { opening: value.opening, factOrder: value.factOrder as string[], closing: value.closing };
  }
}
export function unavailableServiceTransport(): SingleRequestTransport { return async () => { throw new Error("clean_transport_not_configured"); }; }
