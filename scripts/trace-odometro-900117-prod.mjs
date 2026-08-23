#!/usr/bin/env node
/**
 * Traza turno real: Odometro. 900117 (prod / DB + flota Wara).
 *
 * Uso: npx tsx scripts/trace-odometro-900117-prod.mjs [--phone=5491133788190]
 */
import { loadVerifyEnv } from "./load-verify-env.mjs";

loadVerifyEnv();

const phoneArg = process.argv.find((a) => a.startsWith("--phone="));
const PHONE = phoneArg?.split("=", 2)[1]?.trim() ?? "5491133788190";
const SELECTION_TEXT = "Odometro. 900117";
const FLOW_THREAD = "Perfecto, sigo con *El Cacique S.A.*\n¿En qué te puedo ayudar?";

const { prisma } = await import("../src/lib/db.ts");
const { consultarEstadoUnidades, resolveWaraSessionByPhone } = await import("../src/lib/waraApi.ts");
const {
  extractMovilIdFromUnitMessage,
  looksLikeFleetUnitSearchInput,
  resolvePlateWithWaraFleet,
} = await import("../src/lib/waraUnitIntent.ts");
const {
  looksLikeOdometerServiceWithUnitReference,
  looksLikeOdometerIntentStart,
  threadAwaitingOdometerPlate,
} = await import("../src/lib/wara.ts");
const { formatAskUnit } = await import("../src/lib/waraWhatsAppFormat.ts");

function line(label, value) {
  const v =
    value === undefined
      ? "undefined"
      : value === null
        ? "null"
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
  console.log(`${label}: ${v}`);
}

console.log("═".repeat(60));
console.log("TRACE Odometro. 900117");
console.log(`Teléfono: ${PHONE.slice(0, 4)}…${PHONE.slice(-4)}`);
console.log("═".repeat(60));

line("selectionText", SELECTION_TEXT);
line("extractMovilIdFromUnitMessage", extractMovilIdFromUnitMessage(SELECTION_TEXT));
line(
  "looksLikeFleetUnitSearchInput (sin hilo)",
  looksLikeFleetUnitSearchInput(SELECTION_TEXT),
);
line(
  "looksLikeFleetUnitSearchInput (+ hilo El Cacique)",
  looksLikeFleetUnitSearchInput(SELECTION_TEXT, FLOW_THREAD),
);
line("looksLikeOdometerServiceWithUnitReference", looksLikeOdometerServiceWithUnitReference(SELECTION_TEXT));
line("looksLikeOdometerIntentStart", looksLikeOdometerIntentStart(SELECTION_TEXT));

const session = await resolveWaraSessionByPhone(prisma, PHONE);
line("session.ok", session.ok);
line("session.companyName", session.ok ? session.companyName : session.error);
line("session.companyId", session.ok ? session.companyId : null);
line("session.sessionToken", session.ok ? (session.sessionToken ? "set" : "missing") : null);

if (!session.ok || !session.sessionToken) {
  console.error("\n✗ Sin sesión Wara — no se puede consultar flota.");
  process.exit(1);
}

const fleet = await consultarEstadoUnidades(session.sessionToken, []);
line("fleet.ok", fleet.ok);
line("fleet.unidades.length", fleet.ok ? fleet.unidades.length : 0);

if (!fleet.ok || !fleet.unidades.length) {
  console.error("\n✗ Flota vacía o error API.");
  process.exit(1);
}

const movilId = extractMovilIdFromUnitMessage(SELECTION_TEXT, { fleet: fleet.unidades });
line("extractMovilId (+ flota)", movilId);

const byMovilId = fleet.unidades.filter((u) => Number(u.movil_id) === 900117);
line("unidades con movil_id=900117", byMovilId.length);
if (byMovilId.length) {
  line(
    "movil_id=900117 sample",
    byMovilId.slice(0, 3).map((u) => ({
      movil_id: u.movil_id,
      patente: u.patente,
      unidad: u.unidad,
    })),
  );
}

const textMatch = fleet.unidades.filter((u) =>
  String(u.unidad ?? "").includes("900117") ||
  String(u.patente ?? "").includes("900117"),
);
line("unidades con '900117' en unidad/patente", textMatch.length);
if (textMatch.length) {
  line(
    "text 900117 sample",
    textMatch.slice(0, 3).map((u) => ({
      movil_id: u.movil_id,
      patente: u.patente,
      unidad: u.unidad,
    })),
  );
}

const fleetPlate = await resolvePlateWithWaraFleet(
  prisma,
  PHONE,
  SELECTION_TEXT,
  FLOW_THREAD,
  null,
  { preferAi: true, odometerContext: true },
);
line("resolvePlateWithWaraFleet", fleetPlate);

const missingPlateTemplate = formatAskUnit("odometer");
line("formatAskUnit (missing_plate fallback)", missingPlateTemplate.slice(0, 120));

const wouldAskMatricula =
  fleetPlate.ok === false &&
  (fleetPlate.reason === "clarification" ||
    (!fleetPlate.ok && fleetPlate.reason === "not_found"));
line(
  "condición → pedir matrícula (clarification o not_found sin patente)",
  wouldAskMatricula,
);
if (fleetPlate.ok === false && fleetPlate.reason === "clarification") {
  line("mensaje clarification exacto", fleetPlate.message);
}
if (!fleetPlate.ok && fleetPlate.reason === "not_found") {
  line("mensaje missing_plate AI/template", "composeOdometerDialogueReply(missing_plate) o formatAskUnit");
}

line("threadAwaitingOdometerPlate (hilo vacío)", threadAwaitingOdometerPlate(""));

console.log("\n" + "═".repeat(60));
