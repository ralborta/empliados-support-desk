#!/usr/bin/env node
/**
 * Fase 1 COMPLETA — sincroniza Inicio/Elegir a /turn sin Router GPT.
 *
 * Qué hace:
 * 1. Inicio + Elegir → POST /api/whatsapp/turn (cerebro único backend)
 * 2. Elimina regla BBC que mandaba nextFlow=router al Router GPT
 * 3. Guías informativas responde /api/wara/info-guides (no BBC infoMaint/infoOpciones)
 *
 * Uso: node scripts/sync-builderbot-fase1-complete.mjs
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

console.log("=== Fase 1 completa — migración backend único ===\n");

const turn = spawnSync("node", [path.join(__dirname, "sync-builderbot-inicio-turn.mjs")], {
  cwd: root,
  stdio: "inherit",
});

if (turn.status !== 0) {
  process.exit(turn.status ?? 1);
}

console.log(`
✓ Inicio/Elegir apuntan a /api/whatsapp/turn
✓ Router GPT ya NO se invoca desde Inicio (regla router eliminada)

IMPORTANTE — ya NO ejecutar:
  node scripts/sync-builderbot-router-wara.mjs   (obsoleto para Fase 1 completa)

Rollback a BBC Router + /check:
  node scripts/sync-builderbot-inicio-post.mjs

Verificación local:
  npx tsx scripts/verify-turn-pipeline.mjs
  npx tsx scripts/verify-system-health.mjs
`);
