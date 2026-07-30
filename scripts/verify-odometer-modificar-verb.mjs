#!/usr/bin/env node
/** Caso de ejemplo producción 2026-07-29 — no forma parte del gate verify-all. */
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

const thread = [
  "Cliente: Ahora quiero modificar el odometro",
  "Atilio: Para registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es? (podés usar guiones, ej. AB 006 EX, o decime la marca/nombre)",
  "Cliente: AD comienza así la patente",
  "Atilio: No hay ninguna unidad en la flota de El Cacique S.A. con patente que empiece con ASI. Pasame la matrícula completa (ej. NKL 952) o escribí «listado de mis unidades».",
  "Cliente: Pásame el listado?",
  "Atilio: Tenés 414 unidades en El Cacique S.A.. Te muestro 8 como referencia: OST 223, AD 427 MC, RMX 246, BACKUP2504989, MYQ 693, BORQUEZ JUAN y 406 más.",
].join("\n");

const executor = classifyTurnExecutor("Ah es la RMX", thread);
if (executor !== "odometro") {
  console.error(`FAIL: esperaba odometro, obtuvo ${executor}`);
  process.exit(1);
}
console.log("OK — 'Ah es la RMX' sigue en odómetro (no GPS/estado)");
