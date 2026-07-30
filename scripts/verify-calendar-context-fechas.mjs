#!/usr/bin/env node
/**
 * Regresión — Bug real, producción 2026-07-29:
 * Cliente preguntó "Q fecha era ayer?" durante cambio de odómetro y el agente IA respondió
 * "14 de noviembre de 2023" (fecha alucinada). El backend debe resolver hoy/ayer/anteayer
 * con el calendario real en America/Argentina/Buenos_Aires.
 *
 * Uso: npx tsx scripts/verify-calendar-context-fechas.mjs
 */
import assert from "node:assert";
import {
  getCalendarContext,
  looksLikeRelativeDateClarificationQuestion,
  parseFechaFromText,
  resolveRelativeDateClarificationReply,
} from "../src/lib/odometroFecha.ts";

const TZ = "America/Argentina/Buenos_Aires";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

function todayPartsInTz(timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const pick = (t) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { year: pick("year"), month: pick("month"), day: pick("day") };
}

function shiftCalendarDay({ year, month, day }, deltaDays) {
  const base = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
}

function iso(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

console.log("— getCalendarContext coherente con hoy en AR —");
const ctx = getCalendarContext(TZ);
const today = todayPartsInTz(TZ);
const yesterday = shiftCalendarDay(today, -1);
const anteayer = shiftCalendarDay(today, -2);
check("todayIso", ctx.todayIso === iso(today));
check("yesterdayIso", ctx.yesterdayIso === iso(yesterday));
check("anteayerIso", ctx.anteayerIso === iso(anteayer));
check("todayDisplay incluye año", ctx.todayDisplay.includes(String(today.year)));
check("yesterdayDisplay incluye año", ctx.yesterdayDisplay.includes(String(yesterday.year)));

console.log("\n— parseFechaFromText usa el mismo ayer —");
const parsedAyer = parseFechaFromText("19:00 de ayer", TZ);
check("parseFechaFromText ayer empieza con yesterdayIso", parsedAyer?.startsWith(ctx.yesterdayIso) === true);
check("parseFechaFromText ayer hora 19:00", parsedAyer?.includes("T19:00") === true);

console.log("\n— Preguntas relativas (sin IA) —");
const questions = [
  "Q fecha era ayer?",
  "que fecha es hoy",
  "cual dia fue anteayer",
  "ayer que fecha era",
];
for (const q of questions) {
  check(`detecta: "${q}"`, looksLikeRelativeDateClarificationQuestion(q) === true);
}
check('NO detecta "confirmo ayer"', looksLikeRelativeDateClarificationQuestion("Si confirmo ayer") === false);

const replyAyer = resolveRelativeDateClarificationReply("Q fecha era ayer?", TZ);
check("reply ayer menciona yesterdayDisplay", replyAyer?.includes(ctx.yesterdayDisplay.split("/")[0]) === true);
check("reply ayer NO menciona 2023", !/\b2023\b/.test(replyAyer ?? ""));
check("reply ayer incluye año correcto", replyAyer?.includes(String(yesterday.year)) === true);

const replyHoy = resolveRelativeDateClarificationReply("que fecha es hoy", TZ);
check("reply hoy incluye todayDisplay", replyHoy?.includes(ctx.todayDisplay.split("/")[0]) === true);

console.log(`\n✅ ${passed} checks pasaron.`);
