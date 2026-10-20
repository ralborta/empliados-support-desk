import type { SingleRequestTransport } from "../services/guarded-http-transport.js";

export type WaraApiCompany = Readonly<{ id: string; name: string }>;
export type WaraCompanyLookup = Readonly<{
  status: "success" | "not_found" | "backend_error" | "invalid";
  companies: readonly WaraApiCompany[];
  customerName: string | null;
}>;

type JsonRecord = Record<string, unknown>;
type WaraFetch = (url: string, init: RequestInit) => Promise<Response>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}
function text(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() || null : null;
}
function nestedData(value: JsonRecord): JsonRecord {
  return record(value.data) ?? value;
}
function phoneDigits(value: string): string {
  let digits = "";
  for (const character of value) if (character >= "0" && character <= "9") digits += character;
  return digits;
}
function company(value: unknown): WaraApiCompany | null {
  const item = record(value); if (!item) return null;
  const id = text(item.id ?? item.ID ?? item.contacto_id ?? item.contactoId ?? item.ContactoId);
  const name = text(item.empresa ?? item.Empresa ?? item.company ?? item.nombre ?? item.Nombre ?? item.name);
  return id && name ? { id, name } : null;
}
function sessionToken(value: JsonRecord): string | null {
  const data = nestedData(value);
  return text(value.SessionToken ?? value.sessionToken ?? data.SessionToken ?? data.sessionToken);
}
function statusCode(value: JsonRecord): number | null {
  return typeof value.statusCode === "number" ? value.statusCode : null;
}
function wait(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

export class WaraApiSessionTransport {
  private lookupPromise: Promise<Readonly<{ normalized: WaraCompanyLookup; sessionToken: string | null }>> | null = null;
  constructor(private readonly config: Readonly<{
    baseUrl: string; maintenanceBaseUrl: string; rootToken: string; phone: string | null;
    retryDelaysMs?: readonly number[];
  }>, private readonly fetcher: WaraFetch = fetch) {}

  private async post(baseUrl: string, path: string, body: JsonRecord, authorization: string | null, timeoutMs: number): Promise<JsonRecord> {
    const delays = this.config.retryDelaysMs ?? [300, 800];
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        const response = await this.fetcher(`${baseUrl.replace(/\/+$/, "")}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(authorization ? { authorization: `Bearer ${authorization}` } : {}) },
          body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
        });
        const value = record(await response.json().catch(() => ({}))) ?? {};
        if (response.ok) return value;
        if (response.status < 500 || attempt === delays.length) return { ...value, statusCode: response.status };
      } catch (error) {
        if (attempt === delays.length) throw error;
      }
      await wait(delays[attempt] ?? 0);
    }
    return { statusCode: 503 };
  }

  private async lookupWithToken(timeoutMs = 10_000): Promise<Readonly<{ normalized: WaraCompanyLookup; sessionToken: string | null }>> {
    if (!this.config.phone || phoneDigits(this.config.phone).length < 8) return { normalized: { status: "invalid", companies: [], customerName: null }, sessionToken: null };
    const raw = await this.post(this.config.baseUrl, "/ObtenerContactosPorNumero", { token: this.config.rootToken, telefono: phoneDigits(this.config.phone) }, null, timeoutMs);
    const code = statusCode(raw);
    if (code !== null) return { normalized: { status: code >= 500 ? "backend_error" : "invalid", companies: [], customerName: null }, sessionToken: null };
    const rawCompanies = Array.isArray(raw.contactos) ? raw.contactos : record(raw.contacto) ? [raw.contacto] : [];
    const companies = rawCompanies.map(company).filter((item): item is WaraApiCompany => Boolean(item));
    const customerName = text(raw.CustomerName ?? raw.customerName);
    return { normalized: { status: companies.length ? "success" : "not_found", companies, customerName }, sessionToken: companies.length === 1 ? sessionToken(raw) : null };
  }

  lookupCompanies(timeoutMs = 10_000): Promise<Readonly<{ normalized: WaraCompanyLookup; sessionToken: string | null }>> {
    this.lookupPromise ??= this.lookupWithToken(timeoutMs);
    return this.lookupPromise;
  }

  private async tokenFor(companyId: string, timeoutMs: number): Promise<string | null> {
    const lookup = await this.lookupCompanies(timeoutMs);
    if (lookup.normalized.companies.length === 1 && lookup.normalized.companies[0]?.id === companyId && lookup.sessionToken) return lookup.sessionToken;
    const numericId = Number(companyId);
    const raw = await this.post(this.config.baseUrl, "/CreateChatBotToken", { token: this.config.rootToken, contacto_id: Number.isFinite(numericId) ? numericId : companyId }, null, timeoutMs);
    return statusCode(raw) === null ? sessionToken(raw) : null;
  }

  private async fleet(body: Readonly<JsonRecord>, timeoutMs: number): Promise<JsonRecord> {
    const lookup = await this.lookupCompanies(timeoutMs);
    if (lookup.normalized.status !== "success") return lookup.normalized.status === "not_found" ? { status: "not_found", data: { unidades: [] } }
      : lookup.normalized.status === "invalid" ? { status: "validation_error", errors: ["phone_or_company_invalid"] } : { status: "backend_error" };
    const requestedCompanyId = text(body.companyId);
    const selected = requestedCompanyId ? lookup.normalized.companies.find((candidate) => candidate.id === requestedCompanyId) : lookup.normalized.companies.length === 1 ? lookup.normalized.companies[0] : null;
    if (!selected) return { status: "validation_error", errors: ["company_selection_required"] };
    const token = await this.tokenFor(selected.id, timeoutMs);
    if (!token) return { status: "backend_error" };
    const plates = Array.isArray(body.patentes) ? body.patentes.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [];
    const raw = await this.post(this.config.maintenanceBaseUrl, "/ConsultarEstadoUnidades", { token, patentes: plates }, token, timeoutMs);
    const code = statusCode(raw); if (code !== null) return { ...raw, statusCode: code };
    const data = nestedData(raw); const units = Array.isArray(data.unidades) ? data.unidades : [];
    return { ok: raw.ok !== false, data: { cliente: data.cliente, unidades: units.map((value) => ({ ...(record(value) ?? {}), companyId: selected.id })) } };
  }

  readonly transport: SingleRequestTransport = async ({ path, body = {}, timeoutMs }) => {
    if (path === "/ObtenerContactosPorNumero" || path === "/ObtenerEmpresaActiva") {
      const lookup = await this.lookupCompanies(timeoutMs);
      if (lookup.normalized.status === "success") return { ok: true, data: { companies: lookup.normalized.companies } };
      if (lookup.normalized.status === "not_found") return { status: "not_found", data: { companies: [] } };
      if (lookup.normalized.status === "invalid") return { status: "validation_error", errors: ["phone_invalid"] };
      return { status: "backend_error" };
    }
    if (path === "/ConsultarEstadoUnidades" || path === "/ObtenerUnidadActiva" || path === "/ObtenerUnidadAnterior") return this.fleet(body, timeoutMs);
    return { status: "rejected", code: "wara_path_not_available" };
  };
}
