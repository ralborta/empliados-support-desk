#!/usr/bin/env node
/**
 * LIVE — Informes KB (interpret + grounded + resolveTurnExecutor).
 *
 * Con corpus on exige fallback=null y respuesta grounded real.
 * E2E de “Quiero cargar combustible” vía runTurnExecutorPhase solo si
 * PostgreSQL conecta; si no, se marca skipped (no valida texto constante).
 * Incluye bloque fail-closed simulado (WARA_PLATFORM_KB_LLM_SIMULATE_FAILURE).
 *
 * Uso (master off — contrato recognize-always / safe-off):
 *   WARA_INFORMES_KB_ENABLED=false WARA_PLATFORM_KB_LLM_INTERPRET=true \
 *   npx tsx scripts/live-informes-kb.mjs
 *
 * Corpus parcial:
 *   WARA_INFORMES_KB_ENABLED=true WARA_INFORMES_KB_SECTIONS=choferes \
 *   WARA_PLATFORM_KB_LLM_INTERPRET=true npx tsx scripts/live-informes-kb.mjs
 */
import assert from "node:assert/strict";
import { buildGroundedInfoGuideReplyWithMeta } from "../src/lib/infoGuideReplies.ts";
import { resolveTurnExecutor } from "../src/lib/whatsappTurnClassifierAI.ts";
import { shouldRouteTurnToFleetListExecutorHybrid } from "../src/lib/fleetListIntentAI.ts";

if (!process.env.OPENAI_API_KEY?.trim()) {
  console.error("OPENAI_API_KEY requerida");
  process.exit(1);
}
process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "true";
process.env.WARA_TURN_AI_CLASSIFY = "false";
const infCorpusOn = ["true", "1", "yes"].includes(
  String(process.env.WARA_INFORMES_KB_ENABLED ?? "")
    .trim()
    .toLowerCase(),
);
process.env.WARA_INFORMES_KB_ENABLED = infCorpusOn ? "true" : "false";
if (!process.env.WARA_INFORMES_KB_SECTIONS?.trim()) {
  process.env.WARA_INFORMES_KB_SECTIONS = "";
}

const sectionsRaw = String(process.env.WARA_INFORMES_KB_SECTIONS ?? "")
  .trim()
  .toLowerCase();
const sections = new Set(
  sectionsRaw
    ? sectionsRaw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)
    : [],
);
const choferesOn = infCorpusOn && sections.has("choferes");
const puntosOn = infCorpusOn && sections.has("puntos");
const hojasRutaInfOn = infCorpusOn && sections.has("hojas_ruta");
const combustibleInfOn = infCorpusOn && sections.has("combustible");
const mantInfOn = infCorpusOn && sections.has("mantenimiento_deposito");
const tpInfOn = infCorpusOn && sections.has("transporte_pasajeros");
const generalesOn = infCorpusOn && sections.has("generales");

const BAD_GROUNDED =
  /No pude consultar bien la gu[ií]a ahora|no pude consultar la gu[ií]a/i;

const cases = [
  {
    id: "informe-cargas-combustible",
    text: "¿Cómo veo el informe de cargas de combustible?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectDisabled: !combustibleInfOn,
    expectArticlePrefix: combustibleInfOn ? "inf-cb-" : null,
  },
  {
    id: "informe-resumen-tickets",
    text: "Necesito el informe de resumen de tickets de combustible",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectDisabled: !combustibleInfOn,
    expectArticlePrefix: combustibleInfOn ? "inf-cb-" : null,
  },
  {
    id: "informe-ordenes-trabajo",
    text: "¿Cómo veo el informe de órdenes de trabajo en Informes de mantenimiento?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectDisabled: !mantInfOn,
    expectArticlePrefix: mantInfOn ? "inf-md-" : null,
  },
  {
    id: "crear-mantenimiento-operativo",
    text: "Cómo creo un mantenimiento preventivo",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "mantenimiento",
  },
  {
    id: "informe-planilla-horarios",
    text: "¿Cómo veo la planilla de horarios de transporte de pasajeros?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectDisabled: !tpInfOn,
    expectArticlePrefix: tpInfOn ? "inf-tp-" : null,
  },
  {
    id: "crear-hoja-turno-operativo",
    text: "Cómo creo una hoja de turno",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "transporte_publico",
  },
  {
    id: "informe-acoplados",
    text: "¿Cómo veo el informe de acoplados?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectDisabled: !generalesOn,
    expectArticlePrefix: generalesOn ? "inf-gn-" : null,
  },
  {
    id: "informe-historial-frontera-gps",
    text: "¿Cómo abro el informe Historial del menú Informes?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectDisabled: !generalesOn,
    expectArticlePrefix: generalesOn ? "inf-" : null,
  },
  {
    id: "informe-resumen-flota-no-gps",
    text: "Indicame como consultar por el informe de resumen de flota",
    thread: "¿Para qué sirve el módulo de Informes?",
    lastGuideKind: "informes",
    lastGuideCategory: "generales",
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectDisabled: !generalesOn,
    expectArticleId: generalesOn ? "inf-gn-resumen-flota" : null,
    expectFleetListRoute: false,
  },
  {
    id: "informe-resumen-flota-sin-contexto",
    text: "Resumen de flota",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectDisabled: !generalesOn,
    expectArticleId: generalesOn ? "inf-gn-resumen-flota" : null,
    expectFleetListRoute: false,
  },
  {
    id: "listar-informes-no-unidades",
    text: "Listame todos los informes",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectDisabled: !generalesOn,
    expectArticleId: generalesOn ? "inf-mapa" : null,
    expectFleetListRoute: false,
  },
  {
    id: "tipos-de-informes-no-menu-general",
    text: "Qué tipos de informes existen",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectDisabled: !generalesOn,
    expectStructuralMap: generalesOn,
  },
  {
    id: "cargar-combustible-operativo",
    text: "Quiero cargar combustible",
    thread: "",
    expectResolve: "unidades",
    expectRuleId: "operational_fuel_unit_capture",
    expectNormalTarget: "operational_fuel",
    expectGuideNull: true,
    expectNotGuideKinds: ["informes", "paneles", "opciones", "combustible", "mantenimiento"],
  },
  {
    id: "crear-hoja-ruta",
    text: "Cómo creo una hoja de ruta",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "hojas_de_ruta",
  },
  {
    id: "informe-hojas-ruta",
    text: "Quiero el informe de hojas de ruta / viajes planificados",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectDisabled: !hojasRutaInfOn,
    expectArticlePrefix: hojasRutaInfOn ? "inf-hr-" : null,
  },
  {
    id: "crear-punto-interes",
    text: "Cómo creo un punto de interés / geocerca",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "puntos_de_interes",
  },
  {
    id: "informe-entradas-salidas",
    text: "¿Cómo veo el informe de entradas y salidas de puntos?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectDisabled: !puntosOn,
    expectArticlePrefix: puntosOn ? "inf-pt-" : null,
  },
  {
    id: "informe-resumenes-punto",
    text: "Necesito el informe de resúmenes por punto",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectDisabled: !puntosOn,
    expectArticlePrefix: puntosOn ? "inf-pt-" : null,
  },
  {
    id: "informe-km-chofer",
    text: "¿Cómo veo el informe de kilómetros recorridos por chofer?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectDisabled: !choferesOn,
    expectArticlePrefix: choferesOn ? "inf-ch-" : null,
  },
  {
    id: "informe-perfil-manejo",
    text: "Necesito el informe de perfil de manejo de choferes",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectDisabled: !choferesOn,
    expectArticlePrefix: choferesOn ? "inf-ch-" : null,
  },
  {
    id: "parte-disciplinario-frontera",
    text: "¿Dónde veo el parte disciplinario de choferes en Informes?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectDisabled: !choferesOn,
    expectNotGuideKinds: ["utilidades_bloque_2", "certificados"],
  },
  {
    id: "odo",
    text: "Quiero corregir el odómetro",
    thread: "",
    expectResolve: "odometro",
  },
  {
    id: "certificado-intacto",
    text: "Necesito un certificado de cobertura",
    thread: "",
    expectResolve: "certificados",
    expectGuideNull: true,
  },
  {
    id: "gps-intacto",
    text: "Dónde está la unidad AD427MC",
    thread: "",
    expectResolve: "unidades",
    expectGuideNull: true,
    expectNormalTarget: "live_unit",
  },
  {
    id: "continuidad-filtros-reportId",
    text: "¿qué filtros tiene?",
    thread:
      "Cliente: ¿Cómo veo el informe de kilómetros recorridos por chofer?\nAtilio: En Informes → Choferes → Kilómetros recorridos por chofer…",
    lastGuideKind: "informes",
    lastGuideCategory: "choferes",
    lastGuideReportId: "inf-ch-km",
    lastGuideArticleIds: ["inf-ch-km"],
    expectResolve: "info_guides",
    expectGuide: "informes",
    expectReportId: "inf-ch-km",
    expectDisabled: !choferesOn,
    expectArticlePrefix: choferesOn ? "inf-ch-" : null,
  },
];

let failed = 0;

console.log(
  JSON.stringify({
    mode: infCorpusOn ? "corpus_on" : "flag_off_safe",
    sections: process.env.WARA_INFORMES_KB_SECTIONS || "",
    choferesOn,
    puntosOn,
    hojasRutaInfOn,
    combustibleInfOn,
    mantInfOn,
    tpInfOn,
    generalesOn,
    interpret: true,
    singleInterpretReuse: true,
  }),
);

for (const c of cases) {
  await new Promise((r) => setTimeout(r, 700));
  if (typeof c.expectFleetListRoute === "boolean") {
    const fleetListRoute = await shouldRouteTurnToFleetListExecutorHybrid({
      selectionText: c.text,
      threadText: c.thread,
    });
    assert.equal(fleetListRoute, c.expectFleetListRoute, `${c.id} fleet-list route`);
  }
  const resolved = await resolveTurnExecutor(c.text, c.thread || c.text, null, {
    lastGuideKind: c.lastGuideKind ?? null,
    lastGuideCategory: c.lastGuideCategory ?? null,
    lastGuideReportId: c.lastGuideReportId ?? null,
    lastGuideArticleIds: c.lastGuideArticleIds ?? null,
  });
  // Una sola decisión: reutilizar interpret del resolver (no reinterpretar).
  const used = resolved.interpret ?? null;
  let guideKind = used?.guideKind ?? null;
  let fallback = null;
  let replyPreview = "";
  if (resolved.executor === "info_guides" && used) {
    const meta = await buildGroundedInfoGuideReplyWithMeta(
      c.text,
      null,
      null,
      c.thread,
      used,
    );
    guideKind = meta.guideKind;
    fallback = meta.fallback;
    replyPreview = String(meta.message).slice(0, 280);
  }

  const row = {
    id: c.id,
    resolvedExecutor: resolved.executor,
    resolverRuleId: resolved.ruleId ?? null,
    guideKind,
    category: used?.category ?? null,
    reportId: used?.reportId ?? null,
    need: used?.need ?? null,
    articleIds: used?.articleIds ?? [],
    normalTarget: used?.normalTarget ?? null,
    fallback,
    confidence: used?.confidence ?? null,
    executionRequest: used?.executionRequest ?? null,
    replyPreview,
  };
  console.log(JSON.stringify(row));

  try {
    if (c.expectResolve) assert.equal(resolved.executor, c.expectResolve, `${c.id} resolve`);
    if (c.expectRuleId) assert.equal(resolved.ruleId, c.expectRuleId, `${c.id} ruleId`);
    if (c.expectNormalTarget) {
      assert.equal(used?.normalTarget, c.expectNormalTarget, `${c.id} normalTarget`);
    }
    if (c.expectGuide) assert.equal(guideKind, c.expectGuide, `${c.id} guide`);
    if (c.expectGuideNull) assert.equal(guideKind, null, `${c.id} guide must be null`);
    if (c.expectReportId) {
      assert.equal(used?.reportId, c.expectReportId, `${c.id} reportId`);
    }
    if (c.expectNotGuide) {
      assert.notEqual(guideKind, c.expectNotGuide, `${c.id} not hijacked`);
    }
    if (c.expectNotGuideKinds?.length) {
      for (const bad of c.expectNotGuideKinds) {
        assert.notEqual(guideKind, bad, `${c.id} not ${bad}`);
      }
    }
    if (c.expectDisabled) {
      assert.ok(
        fallback === "informes_flag_off" || fallback === "informes_section_off",
        `${c.id} disabled fallback`,
      );
      assert.equal((used?.articleIds ?? []).length, 0, `${c.id} no inf-* bodies`);
      assert.match(
        replyPreview,
        /no tengo habilitada|todavía no está habilitada|Informes/i,
        `${c.id} disabled msg`,
      );
    } else if (resolved.executor === "info_guides" && infCorpusOn && c.expectGuide === "informes") {
      assert.equal(fallback, null, `${c.id} fallback must be null on corpus`);
      assert.ok(replyPreview.trim().length > 0, `${c.id} grounded reply required`);
      assert.ok(!BAD_GROUNDED.test(replyPreview), `${c.id} must not use consult-failure filler`);
      const ids = used?.articleIds ?? [];
      assert.ok(ids.length > 0, `${c.id} articleIds must not be empty`);
      assert.ok(
        ids.every((id) => String(id).startsWith("inf-")),
        `${c.id} invalid article ids ${JSON.stringify(ids)}`,
      );
    } else if (c.expectArticlePrefix) {
      const ids = used?.articleIds ?? [];
      assert.ok(
        ids.some((id) => String(id).startsWith(c.expectArticlePrefix)),
        `${c.id} expect article ${c.expectArticlePrefix}* got ${JSON.stringify(ids)}`,
      );
    }
    if (c.expectArticleId) {
      assert.ok(
        (used?.articleIds ?? []).includes(c.expectArticleId),
        `${c.id} expect article ${c.expectArticleId}`,
      );
    }
    if (c.expectStructuralMap) {
      const ids = used?.articleIds ?? [];
      assert.ok(ids.length > 0, `${c.id} articleIds must not be empty`);
      assert.ok(
        ids.every((id) => id === "inf-mapa" || id.startsWith("inf-idx-")),
        `${c.id} expected inf-mapa/inf-idx-* got ${JSON.stringify(ids)}`,
      );
      assert.notEqual(used?.need, "ambiguous", `${c.id} must not clarify`);
      assert.equal(fallback, null, `${c.id} must not clarify_or_limit`);
    }
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${c.id}:`, e instanceof Error ? e.message : e);
  }
}

// E2E real: solo si PostgreSQL conecta. Sin DB → skipped (no se valida texto constante).
// Si la DB conecta y runTurnExecutorPhase falla en asserts → la suite FALLA.
{
  const fuelText = "Quiero cargar combustible";
  const dbUrl = process.env.DATABASE_URL?.trim() || "";
  if (!dbUrl) {
    console.log(
      JSON.stringify({
        id: "e2e-cargar-combustible-phase",
        mode: "skipped",
        reason: "DATABASE_URL missing",
      }),
    );
  } else {
    let dbOk = false;
    try {
      const { prisma } = await import("../src/lib/db.ts");
      await prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch (dbErr) {
      console.log(
        JSON.stringify({
          id: "e2e-cargar-combustible-phase",
          mode: "skipped",
          reason: "postgres_unreachable",
          detail: dbErr instanceof Error ? dbErr.message.slice(0, 160) : String(dbErr),
        }),
      );
    }
    if (dbOk) {
      try {
        const resolvedFuel = await resolveTurnExecutor(fuelText, fuelText, null);
        assert.equal(resolvedFuel.executor, "unidades", "e2e fuel resolve");
        assert.equal(
          resolvedFuel.interpret?.normalTarget,
          "operational_fuel",
          "e2e fuel normalTarget",
        );
        const { runTurnExecutorPhase } = await import("../src/lib/whatsappTurnExecutor.ts");
        const phone = `5490000${String(Date.now()).slice(-6)}`;
        const phase = await runTurnExecutorPhase({
          rawPhone: phone,
          selectionText: fuelText,
          apiKey:
            process.env.BUILDERBOT_CONTEXT_API_KEY ||
            process.env.PULZE_API_KEY ||
            "test",
        });
        const msg = String(phase.message ?? "");
        console.log(
          JSON.stringify({
            id: "e2e-cargar-combustible-phase",
            mode: "runTurnExecutorPhase",
            executor: phase.executor,
            ok: phase.ok,
            normalTarget: resolvedFuel.interpret?.normalTarget ?? null,
            replyPreview: msg.slice(0, 280),
          }),
        );
        assert.equal(phase.executor, "unidades", "e2e combustible executor");
        assert.match(
          msg,
          /patente|unidad|matr[ií]cula|nombre|interno/i,
          "e2e combustible must ask for unit/plate",
        );
        assert.doesNotMatch(
          msg,
          /mantenimiento|paneles|informes\s*→|Informes →|protocolos de alarmas/i,
          "e2e combustible must not return MT/Paneles/Informes content",
        );
      } catch (e) {
        failed += 1;
        console.error(
          "FAIL e2e-cargar-combustible-phase:",
          e instanceof Error ? e.message : e,
        );
      }
    }
  }
}

// Simulación fail-closed: resolve + grounded neutro (sin secuestrar módulos).
{
  const prev = process.env.WARA_PLATFORM_KB_LLM_SIMULATE_FAILURE;
  process.env.WARA_PLATFORM_KB_LLM_SIMULATE_FAILURE = "timeout";
  const neutralMsgRe =
    /No pude interpretar bien tu consulta ahora|reformularla/i;
  try {
    const hijackCases = [
      {
        id: "failclosed-resumen-flota",
        text: "Indicame como consultar por el informe de resumen de flota",
        thread: "El módulo Informes permite consultar reportes.",
        ctx: {
          lastGuideKind: "informes",
          lastGuideCategory: "generales",
          lastGuideReportId: null,
          lastGuideArticleIds: [],
        },
      },
      {
        id: "failclosed-listar-informes",
        text: "Listame todos los informes disponibles de la plataforma Wara",
        thread: "Estamos consultando Informes",
        ctx: {
          lastGuideKind: "informes",
          lastGuideCategory: "generales",
          lastGuideReportId: null,
          lastGuideArticleIds: [],
        },
      },
      {
        id: "failclosed-tipos-informes",
        text: "¿Qué tipo de informes puedo consultar en la plataforma Wara?",
        thread: "",
        ctx: {},
      },
      {
        id: "failclosed-cargar-combustible",
        text: "Quiero cargar combustible",
        thread: "",
        ctx: {},
      },
      {
        id: "failclosed-gps",
        text: "¿Dónde está la unidad AD427MC?",
        thread: "",
        ctx: {},
      },
      {
        id: "failclosed-mantenimiento",
        text: "Cómo creo un mantenimiento preventivo",
        thread: "",
        ctx: {},
      },
    ];
    for (const c of hijackCases) {
      try {
        const resolved = await resolveTurnExecutor(c.text, c.thread || c.text, null, c.ctx);
        assert.equal(
          resolved.ruleId,
          "platform_kb_llm_fail_closed",
          `${c.id} must use fail-closed rule`,
        );
        assert.notEqual(resolved.executor, "unidades", `${c.id} no unidades hijack`);
        assert.notEqual(resolved.executor, "mantenimiento", `${c.id} no MT hijack`);
        assert.equal(
          resolved.interpret?.normalTarget ?? null,
          null,
          `${c.id} no operational target without LLM`,
        );

        const grounded = await buildGroundedInfoGuideReplyWithMeta(
          c.text,
          null,
          null,
          c.thread || c.text,
          resolved.interpret,
        );
        const row = {
          id: c.id,
          mode: "simulate_llm_failure",
          resolvedExecutor: resolved.executor,
          resolverRuleId: resolved.ruleId ?? null,
          guideKind: grounded.guideKind,
          articleIds: grounded.interpret?.articleIds ?? [],
          fallback: grounded.fallback,
          normalTarget: resolved.interpret?.normalTarget ?? null,
          reason: resolved.interpret?.reason ?? null,
          replyPreview: String(grounded.message).slice(0, 160),
        };
        console.log(JSON.stringify(row));
        assert.equal(grounded.guideKind, null, `${c.id} grounded guideKind null`);
        assert.equal(
          (grounded.interpret?.articleIds ?? []).length,
          0,
          `${c.id} grounded articleIds empty`,
        );
        assert.equal(grounded.fallback, "clarify_question", `${c.id} fallback`);
        assert.match(String(grounded.message), neutralMsgRe, `${c.id} neutral msg`);
        assert.doesNotMatch(
          String(grounded.message),
          /###\s*inf-|mantenimiento preventivo|Informes →|paneles/i,
          `${c.id} no corpus/module content`,
        );
      } catch (e) {
        failed += 1;
        console.error(`FAIL ${c.id}:`, e instanceof Error ? e.message : e);
      }
    }

    // Combustible fail-closed vía runTurnExecutorPhase solo si Postgres responde.
    const fuelText = "Quiero cargar combustible";
    const dbUrl = process.env.DATABASE_URL?.trim() || "";
    if (!dbUrl) {
      console.log(
        JSON.stringify({
          id: "failclosed-e2e-cargar-combustible-phase",
          mode: "skipped",
          reason: "DATABASE_URL missing",
        }),
      );
    } else {
      let dbOk = false;
      try {
        const { prisma } = await import("../src/lib/db.ts");
        await prisma.$queryRaw`SELECT 1`;
        dbOk = true;
      } catch (dbErr) {
        console.log(
          JSON.stringify({
            id: "failclosed-e2e-cargar-combustible-phase",
            mode: "skipped",
            reason: "postgres_unreachable",
            detail: dbErr instanceof Error ? dbErr.message.slice(0, 160) : String(dbErr),
          }),
        );
      }
      if (dbOk) {
        try {
          const { runTurnExecutorPhase } = await import("../src/lib/whatsappTurnExecutor.ts");
          const phone = `5490001${String(Date.now()).slice(-6)}`;
          const phase = await runTurnExecutorPhase({
            rawPhone: phone,
            selectionText: fuelText,
            apiKey:
              process.env.BUILDERBOT_CONTEXT_API_KEY ||
              process.env.PULZE_API_KEY ||
              "test",
          });
          const msg = String(phase.message ?? "");
          console.log(
            JSON.stringify({
              id: "failclosed-e2e-cargar-combustible-phase",
              mode: "runTurnExecutorPhase",
              executor: phase.executor,
              ok: phase.ok,
              replyPreview: msg.slice(0, 280),
            }),
          );
          assert.notEqual(phase.executor, "unidades", "failclosed fuel not unidades");
          assert.notEqual(phase.executor, "mantenimiento", "failclosed fuel not MT");
          assert.match(msg, neutralMsgRe, "failclosed fuel neutral msg");
          assert.doesNotMatch(
            msg,
            /mantenimiento|paneles|Informes →|###\s*inf-/i,
            "failclosed fuel no module content",
          );
        } catch (e) {
          failed += 1;
          console.error(
            "FAIL failclosed-e2e-cargar-combustible-phase:",
            e instanceof Error ? e.message : e,
          );
        }
      }
    }
  } finally {
    if (prev === undefined) delete process.env.WARA_PLATFORM_KB_LLM_SIMULATE_FAILURE;
    else process.env.WARA_PLATFORM_KB_LLM_SIMULATE_FAILURE = prev;
  }
}

if (failed) {
  console.error(`live-informes-kb: ${failed} failed`);
  process.exit(1);
}
console.log("OK live-informes-kb");
