/**
 * Rutas autorizadas Fase 9A — solo bajo apps/wara-v2/.local-data/governance/
 * Sin paths arbitrarios ni variables que apunten a producción.
 */
import { mkdirSync, existsSync, realpathSync, lstatSync } from "node:fs";
import { resolve, relative, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Raíz fija del paquete app — no configurable a dirs externos. */
export const GOVERNANCE_ROOT = resolve(HERE, "../../.local-data/governance");

export const GOV_DIRS = {
  quarantine: join(GOVERNANCE_ROOT, "01-quarantine"),
  candidate: join(GOVERNANCE_ROOT, "02-candidate"),
  approved: join(GOVERNANCE_ROOT, "03-approved"),
  synthetic: join(GOVERNANCE_ROOT, "04-synthetic"),
  evalResults: join(GOVERNANCE_ROOT, "05-eval-results"),
  reports: join(GOVERNANCE_ROOT, "06-reports-sanitized"),
  drop: join(GOVERNANCE_ROOT, "00-dropbox-inbox"),
} as const;

export function ensureGovDirs(): void {
  for (const d of Object.values(GOV_DIRS)) {
    mkdirSync(d, { recursive: true });
  }
}

/** Rechaza path traversal / symlink escape / paths fuera de root. */
export function assertInsideGovernance(path: string): string {
  const abs = resolve(path);
  const root = resolve(GOVERNANCE_ROOT);
  if (!abs.startsWith(root + "/") && abs !== root) {
    throw new Error("path_outside_governance");
  }
  if (existsSync(abs)) {
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) {
      const real = realpathSync(abs);
      if (!real.startsWith(root + "/") && real !== root) {
        throw new Error("symlink_escape_forbidden");
      }
    }
  }
  const rel = relative(root, abs);
  if (rel.startsWith("..") || rel.includes("\0")) {
    throw new Error("path_traversal_forbidden");
  }
  return abs;
}

export function assertDropboxFile(filename: string): string {
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    throw new Error("path_traversal_forbidden");
  }
  return assertInsideGovernance(join(GOV_DIRS.drop, filename));
}
