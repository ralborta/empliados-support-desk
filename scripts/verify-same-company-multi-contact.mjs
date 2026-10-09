#!/usr/bin/env node
/**
 * Bug real 2026-10-07: 5492615199951 / Suprema Corte — Wara devolvía 2 contactos
 * de la misma empresa y Kira pedía elegir empresa sin listar; «Poder Judicial» no matcheaba.
 *
 * Uso: npx tsx scripts/verify-same-company-multi-contact.mjs
 */
import assert from "node:assert/strict";
import {
  waraRequiresCompanyConfirmation,
  waraCanAutoSelectCompany,
  preferContactForSameCompany,
  companyIdentityKey,
  isUsableLocalWaraCompany,
  contactMatchesCompanySelection,
  companySelectionMenuMessage,
  formatContactsMenu,
} from "../src/lib/waraApi.ts";
import { looksLikeJustRegisteredPhoneInWara } from "../src/lib/unregisteredPhoneHandoff.ts";

const contacts = [
  { id: 496710, nombre: "CARLOS DAMIAN RODRIGUEZ", empresa: "SUPREMA CORTE DE JUSTICIA" },
  { id: 155350, nombre: "SUPREMA CORTE DE JUSTICIA", empresa: "SUPREMA CORTE DE JUSTICIA" },
];

assert.equal(companyIdentityKey(contacts[0]), companyIdentityKey(contacts[1]));
assert.equal(waraRequiresCompanyConfirmation(contacts), false, "misma empresa → no pedir menú");
assert.equal(waraCanAutoSelectCompany(contacts), true, "misma empresa → autoelegir");
assert.equal(
  preferContactForSameCompany(contacts).id,
  496710,
  "prefiere contacto persona sobre razón social",
);

assert.equal(
  waraRequiresCompanyConfirmation([
    contacts[0],
    { id: 9, nombre: "Otra SA", empresa: "Otra SA" },
  ]),
  true,
  "empresas distintas → sí pedir",
);

assert.equal(isUsableLocalWaraCompany("No registrado en Wara"), false);
assert.equal(isUsableLocalWaraCompany("SUPREMA CORTE DE JUSTICIA"), true);

assert.equal(looksLikeJustRegisteredPhoneInWara("Cargado"), true);
assert.equal(looksLikeJustRegisteredPhoneInWara("ya cargado"), true);
assert.equal(looksLikeJustRegisteredPhoneInWara("necesito cargarle el odometro"), false);

assert.equal(
  contactMatchesCompanySelection(contacts[0], "Poder Judicial"),
  true,
  "Poder Judicial → Suprema Corte",
);
assert.equal(contactMatchesCompanySelection(contacts[0], "SUPREMA CORTE DE JUSTICIA"), true);

const menuMsg = companySelectionMenuMessage(formatContactsMenu(contacts));
assert.match(menuMsg, /SUPREMA CORTE DE JUSTICIA/);
assert.match(menuMsg, /Respondé con el número/);

console.log("OK verify-same-company-multi-contact");
