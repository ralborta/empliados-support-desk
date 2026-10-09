import assert from "node:assert/strict";
import test from "node:test";
import { unitStatusFacts } from "../adapters/services/unit-status-facts.js";

test("unit status always identifies the last known position and its freshness without calling it current", () => {
  const facts = unitStatusFacts({ unidades: [{ movil_id: 900115, unidad: "M900-115", patente: "AD427MC",
    ultimo_reporte: { fecha: "2026-08-17T14:00:00Z", hace_segundos: 7200 },
    ultima_posicion: { lat: -34.6037, lon: -58.3816, hace_segundos: 7300 }, ultima_ignicion: { estado: false } }] },
  { timeZone: "America/Argentina/Buenos_Aires", now: new Date("2026-08-17T16:00:00Z") });
  const reply = facts.map((fact) => fact.text).join("\n");
  assert.match(reply, /Última posición conocida/);
  assert.match(reply, /google\.com\/maps/);
  assert.match(reply, /hace 2 horas/);
  assert.doesNotMatch(reply, /posición actual/i);
  assert.equal(facts.every((fact) => fact.verified), true);
});

test("unit status states explicitly when no position exists", () => {
  const facts = unitStatusFacts({ unit: { id: "u", label: "Unidad 900110" } }, { timeZone: "America/Argentina/Buenos_Aires", now: new Date() });
  assert.match(facts.map((fact) => fact.text).join("\n"), /no informó una última posición conocida/i);
});
