#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  ODOMETER_INFORMATION_AMBIGUOUS_CLARIFY,
  ODOMETER_INFORMATION_DEFINITION_REPLY,
  ODOMETER_INFORMATION_PROCEDURE_REPLY,
  replyForOdometerInformation,
  shouldRouteOdometerInformationToGuide,
} from "../src/lib/odometerInformationGuide.ts";
import { buildGroundedInfoGuideReplyWithMeta } from "../src/lib/infoGuideReplies.ts";
import { shouldRouteCertificateDefinitionToGuide } from "../src/lib/certificateDefinitionGuide.ts";

const baseInfo = {
  route: "info_guides",
  guideKind: null,
  need: "definition",
  articleIds: [],
  clarifyQuestion: null,
  executionRequest: false,
  confidence: 0.9,
  reason: "test",
  category: null,
  reportId: null,
  normalTarget: "odometer_information",
};

assert.equal(
  shouldRouteOdometerInformationToGuide({
    interpret: baseInfo,
    rulesExecutor: "odometro",
  }),
  true,
  "definición de odómetro puede superar hardOps",
);
assert.equal(
  shouldRouteOdometerInformationToGuide({
    interpret: { ...baseInfo, need: "execute", executionRequest: true, normalTarget: null },
    rulesExecutor: "odometro",
  }),
  false,
  "ejecución de odómetro sigue protegida",
);
assert.equal(
  shouldRouteOdometerInformationToGuide({
    interpret: baseInfo,
    rulesExecutor: "certificados",
  }),
  false,
  "no reclasifica otros dominios",
);

assert.equal(
  shouldRouteCertificateDefinitionToGuide({
    interpret: {
      ...baseInfo,
      normalTarget: null,
      need: "definition",
    },
    rulesExecutor: "certificados",
  }),
  true,
);

assert.equal(replyForOdometerInformation(baseInfo), ODOMETER_INFORMATION_DEFINITION_REPLY);
assert.equal(
  replyForOdometerInformation({ ...baseInfo, need: "procedure" }),
  ODOMETER_INFORMATION_PROCEDURE_REPLY,
);
assert.equal(
  replyForOdometerInformation({
    ...baseInfo,
    need: "ambiguous",
    clarifyQuestion: ODOMETER_INFORMATION_AMBIGUOUS_CLARIFY,
  }),
  ODOMETER_INFORMATION_AMBIGUOUS_CLARIFY,
);

const defReply = await buildGroundedInfoGuideReplyWithMeta(
  "Qué es el odometro?",
  null,
  null,
  "",
  baseInfo,
);
assert.equal(defReply.message, ODOMETER_INFORMATION_DEFINITION_REPLY);
assert.doesNotMatch(defReply.message, /servicios y recorridos|transporte|patente/i);

const procReply = await buildGroundedInfoGuideReplyWithMeta(
  "Cómo actualizo el odómetro?",
  null,
  null,
  "",
  { ...baseInfo, need: "procedure" },
);
assert.equal(procReply.message, ODOMETER_INFORMATION_PROCEDURE_REPLY);

console.log("OK verify-odometer-information-guide");
