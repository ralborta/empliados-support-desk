/** Estado de config Odoo (sin llamadas JSON-RPC en piloto). */

export type OdooConfigStatus = {
  configured: boolean;
  missing: string[];
};

export function getOdooConfigStatus(
  env: NodeJS.ProcessEnv = process.env,
): OdooConfigStatus {
  const missing: string[] = [];
  if (!env.ODOO_URL?.trim()) missing.push("ODOO_URL");
  if (!env.ODOO_DB?.trim()) missing.push("ODOO_DB");
  if (!env.ODOO_EMAIL?.trim()) missing.push("ODOO_EMAIL");
  if (!env.ODOO_API_KEY?.trim()) missing.push("ODOO_API_KEY");
  return { configured: missing.length === 0, missing };
}
