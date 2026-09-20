#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  CERTIFICATE_DEFINITION_REPLY,
  shouldRouteCertificateDefinitionToGuide,
} from "../src/lib/certificateDefinitionGuide.ts";
import { buildGroundedInfoGuideReplyWithMeta } from "../src/lib/infoGuideReplies.ts";

const base = {
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
  normalTarget: null,
};

assert.equal(
  shouldRouteCertificateDefinitionToGuide({
    interpret: base,
    rulesExecutor: "certificados",
  }),
  true,
  "definición read-only puede superar hardOps de certificado",
);
assert.equal(
  shouldRouteCertificateDefinitionToGuide({
    interpret: { ...base, need: "ambiguous" },
    rulesExecutor: "certificados",
  }),
  false,
  "pedido ambiguo de certificado sigue protegido por hardOps",
);
assert.equal(
  shouldRouteCertificateDefinitionToGuide({
    interpret: { ...base, need: "execute", executionRequest: true },
    rulesExecutor: "certificados",
  }),
  false,
  "pedido de emisión sigue protegido por hardOps",
);
assert.equal(
  shouldRouteCertificateDefinitionToGuide({
    interpret: base,
    rulesExecutor: "info_guides",
  }),
  false,
  "la excepción no reclasifica otros dominios",
);

const reply = await buildGroundedInfoGuideReplyWithMeta(
  "¿Qué es un certificado?",
  null,
  null,
  "",
  { ...base, normalTarget: "certificate_definition" },
);
assert.equal(reply.message, CERTIFICATE_DEFINITION_REPLY);
assert.match(reply.message, /certificado de cobertura/i);
assert.doesNotMatch(reply.message, /decime cu[aá]l|opciones, unidades|patente/i);

const unitsReply = await buildGroundedInfoGuideReplyWithMeta(
  "Dame información sobre cómo mover unidades en diferentes grupos",
  null,
  null,
  "",
  {
    ...base,
    guideKind: "unidades",
    need: "procedure",
    reportId: "unidades_grupos",
  },
);
assert.equal(unitsReply.guideKind, "unidades");
assert.match(unitsReply.message, /Mover unidades/i);
assert.match(unitsReply.message, /reasignar unidades entre grupos/i);
assert.doesNotMatch(unitsReply.message, /no puedo ayudarte|asesor humano/i);

const transportReply = await buildGroundedInfoGuideReplyWithMeta(
  "¿Me podés ayudar con transporte de pasajeros?",
  null,
  null,
  "",
  {
    ...base,
    guideKind: "transporte_publico",
    need: "ambiguous",
    clarifyQuestion:
      "Sí. ¿Necesitás ayuda con servicios y recorridos, paradas, turnos, hojas de turno, monitoreo o un error puntual?",
  },
);
assert.equal(transportReply.guideKind, "transporte_publico");
assert.match(transportReply.message, /servicios y recorridos/i);
assert.doesNotMatch(transportReply.message, /no pude consultar|ped[ií] un asesor/i);

console.log("OK verify-platform-guide-routing-regressions");
