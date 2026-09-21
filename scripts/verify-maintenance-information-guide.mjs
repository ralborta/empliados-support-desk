#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  MAINTENANCE_ASSIGN_PLAN_ARTICLE_ID,
  MAINTENANCE_CONCEPT_ARTICLE_ID,
  MAINTENANCE_INFORMATION_AMBIGUOUS_CLARIFY,
  shouldRouteMaintenanceInformationToGuide,
} from "../src/lib/maintenanceInformationGuide.ts";
import { buildGroundedInfoGuideReplyWithMeta } from "../src/lib/infoGuideReplies.ts";
import { buildFailClosedPlatformInterpret } from "../src/lib/infoGuideInterpretAI.ts";

const baseDef = {
  route: "info_guides",
  guideKind: "mantenimiento",
  need: "definition",
  articleIds: [MAINTENANCE_CONCEPT_ARTICLE_ID],
  clarifyQuestion: null,
  executionRequest: false,
  confidence: 0.98,
  reason: "maintenance_information_resolve:mt_definition",
  category: null,
  reportId: null,
  normalTarget: "maintenance_information",
};

assert.equal(shouldRouteMaintenanceInformationToGuide(baseDef), true);
assert.equal(
  shouldRouteMaintenanceInformationToGuide({
    ...baseDef,
    need: "execute",
    executionRequest: true,
    normalTarget: "maintenance_operation",
  }),
  false,
);

const failClosed = buildFailClosedPlatformInterpret("test");
assert.match(failClosed.reason, /interpret_llm_fail_closed/);

const defReply = await buildGroundedInfoGuideReplyWithMeta(
  "Y q es un mantenimiento?",
  null,
  null,
  "",
  baseDef,
);
assert.equal(defReply.guideKind, "mantenimiento");
assert.match(defReply.message, /Mantenimiento|Utilidades|planes/i);
assert.doesNotMatch(defReply.message, /No pude consultar bien la guía|ped[ií] un asesor/i);

const assignReply = await buildGroundedInfoGuideReplyWithMeta(
  "Cómo asigno un plan?",
  null,
  null,
  "",
  {
    ...baseDef,
    need: "procedure",
    articleIds: [MAINTENANCE_ASSIGN_PLAN_ARTICLE_ID],
    reason: "maintenance_information_resolve:mt_procedure_asignar",
  },
);
assert.equal(assignReply.guideKind, "mantenimiento");
assert.match(assignReply.message, /asign|plan|Unidades|TAREAS/i);
assert.doesNotMatch(assignReply.message, /No pude consultar bien la guía/i);

const ambReply = await buildGroundedInfoGuideReplyWithMeta(
  "Mantenimiento",
  null,
  null,
  "",
  {
    ...baseDef,
    need: "ambiguous",
    articleIds: [],
    clarifyQuestion: MAINTENANCE_INFORMATION_AMBIGUOUS_CLARIFY,
    reason: "maintenance_information_resolve:mt_ambiguous",
  },
);
assert.equal(ambReply.message, MAINTENANCE_INFORMATION_AMBIGUOUS_CLARIFY);

console.log("OK verify-maintenance-information-guide");
