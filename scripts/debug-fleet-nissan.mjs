#!/usr/bin/env node
import { prisma } from "../src/lib/db.ts";
import { consultarEstadoUnidades, resolveWaraSessionByPhone } from "../src/lib/waraApi.ts";
import {
  resolveUnitQuery,
  filterUnitsBySearchTerms,
} from "../src/lib/waraUnitIntent.ts";

const phone = process.argv[2] || "5491133788190";
const session = await resolveWaraSessionByPhone(prisma, phone);
if (!session.ok) {
  console.error("session fail", session);
  process.exit(1);
}
const fleet = await consultarEstadoUnidades(session.sessionToken, []);
console.log("company", session.companyName, "fleet", fleet.unidades?.length);

const nissanUnits = fleet.unidades.filter((u) =>
  `${u.patente ?? ""} ${u.unidad ?? ""}`.toLowerCase().includes("nissan"),
);
console.log(
  "nissan name match",
  nissanUnits.length,
  nissanUnits.slice(0, 5).map((u) => ({ p: u.patente, u: u.unidad })),
);

const ad427 = fleet.unidades.filter((u) =>
  (u.patente ?? "").replace(/\s+/g, "").includes("AD427"),
);
console.log("AD427", ad427.map((u) => ({ p: u.patente, u: u.unidad })));

for (const text of ["Nissan", "No sé si mi GPS está marcando bien", "quiero ver la ignicio de mi unidad"]) {
  const resolved = await resolveUnitQuery({ rawText: text, threadText: "", units: fleet.unidades });
  console.log("\n---", text, "---");
  console.log(resolved);
}
