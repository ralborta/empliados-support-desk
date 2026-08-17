import type { CommitBinding } from "./operational-service-contracts.js";
import { GuardedHttpTransport, type TenantPermission } from "./guarded-http-transport.js";
import type { NormalizedServiceResult } from "./normalized-service-result.js";

export type WaraReadCapability = "company.list" | "company.get_active" | "unit.search" | "unit.get_active" | "unit.get_previous" | "gps.get_status" | "maintenance.get_status" | "certificate.get_status";
export type WaraWriteCapability = "odometer.update" | "hourmeter.update" | "maintenance.create" | "certificate.issue";
const PATHS: Record<WaraReadCapability | WaraWriteCapability, string> = {
  "company.list": "/ObtenerContactosPorNumero", "company.get_active": "/ObtenerEmpresaActiva",
  "unit.search": "/ConsultarEstadoUnidades", "unit.get_active": "/ObtenerUnidadActiva",
  "unit.get_previous": "/ObtenerUnidadAnterior", "gps.get_status": "/ConsultarEstadoGPS",
  "maintenance.get_status": "/ConsultarEstadoMantenimiento", "certificate.get_status": "/ConsultarEstadoCertificado",
  "odometer.update": "/ActualizarOdometro", "hourmeter.update": "/ActualizarHorometro",
  "maintenance.create": "/CrearMantenimiento", "certificate.issue": "/Certificadocobertura",
};

export class GuardedWaraAdapter {
  constructor(private readonly http: GuardedHttpTransport) {}
  read<T>(input: Readonly<{ capability: WaraReadCapability; tenant: TenantPermission; correlationId: string; authorized: boolean; query: Readonly<Record<string, unknown>> }>): Promise<NormalizedServiceResult<T>> {
    return this.http.execute<T>({ ...input, kind: "read", path: PATHS[input.capability], body: input.query });
  }
  write<T>(input: Readonly<{ capability: WaraWriteCapability; tenant: TenantPermission; correlationId: string; authorized: boolean; payload: Readonly<Record<string, unknown>>; binding: CommitBinding; pendingBinding: CommitBinding | undefined }>): Promise<NormalizedServiceResult<T>> {
    return this.http.execute<T>({ ...input, kind: "write", path: PATHS[input.capability], body: input.payload });
  }
}
