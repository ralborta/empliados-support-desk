/**
 * Auth fake con scopes — sin OAuth ni secretos reales.
 */
export type FakePrincipal = {
  token: string;
  tenantId: string;
  scopes: Set<string>;
};

const TOKENS = new Map<string, FakePrincipal>([
  [
    "local-admin",
    {
      token: "local-admin",
      tenantId: "*",
      scopes: new Set([
        "health",
        "ingress:write",
        "turn:read",
        "operation:read",
        "confirm:write",
        "worker:run",
        "trace:read",
        "replay:run",
        "outbox:read",
        "reconcile:run",
      ]),
    },
  ],
  [
    "local-tenant-a",
    {
      token: "local-tenant-a",
      tenantId: "tenant_a",
      scopes: new Set([
        "health",
        "ingress:write",
        "turn:read",
        "operation:read",
        "confirm:write",
        "trace:read",
        "replay:run",
        "outbox:read",
      ]),
    },
  ],
  [
    "local-tenant-b",
    {
      token: "local-tenant-b",
      tenantId: "tenant_b",
      scopes: new Set([
        "health",
        "ingress:write",
        "turn:read",
        "operation:read",
        "confirm:write",
        "trace:read",
      ]),
    },
  ],
]);

export function authenticate(
  authorization: string | undefined,
): FakePrincipal | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return TOKENS.get(token) ?? null;
}

export function authorize(
  principal: FakePrincipal,
  scope: string,
  resourceTenantId?: string,
): { ok: true } | { ok: false; code: string } {
  if (!principal.scopes.has(scope)) {
    return { ok: false, code: "forbidden_scope" };
  }
  if (
    resourceTenantId &&
    principal.tenantId !== "*" &&
    principal.tenantId !== resourceTenantId
  ) {
    return { ok: false, code: "forbidden_tenant" };
  }
  return { ok: true };
}
