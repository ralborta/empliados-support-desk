/**
 * Diagnóstico de persistencia piloto — sin datos sensibles.
 */
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { dirname } from "node:path";

export type PilotPersistenceDiagnostics = {
  enabled: boolean;
  pathPartial: string | null;
  pathAccessible: boolean;
  pathWritable: boolean;
  fileExists: boolean;
  fileLoaded: boolean;
  conversationsRecovered: number;
  lastPersistOkAt: string | null;
  lastPersistError: string | null;
  lastLoadError: string | null;
  startupWarning: string | null;
};

export function sanitizePersistencePath(path: string | null | undefined): string | null {
  if (!path?.trim()) return null;
  const p = path.trim();
  if (p.length <= 12) return `…${p.slice(-8)}`;
  return `…${p.slice(-24)}`;
}

export function probePersistencePath(path: string): {
  accessible: boolean;
  writable: boolean;
  fileExists: boolean;
  dirWritable: boolean;
} {
  const dir = dirname(path);
  let accessible = false;
  let writable = false;
  let dirWritable = false;
  const fileExists = existsSync(path);
  try {
    accessSync(dir, constants.F_OK);
    accessible = true;
    try {
      accessSync(dir, constants.W_OK);
      dirWritable = true;
    } catch {
      dirWritable = false;
    }
  } catch {
    accessible = false;
  }
  if (fileExists) {
    try {
      accessSync(path, constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
  } else {
    writable = dirWritable;
  }
  try {
    if (fileExists) statSync(path);
  } catch {
    /* ignore */
  }
  return { accessible, writable, fileExists, dirWritable };
}
