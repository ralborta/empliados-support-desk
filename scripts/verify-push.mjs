#!/usr/bin/env node
/**
 * Gate rápido pre-push (~30 suites críticas). Suite completa: npm test / verify-all.mjs
 */
import { runVerifySuites } from "./verify-runner.mjs";

/** Subconjunto que cubre routing, unidades, odómetro, certificados y regresiones recientes. */
const PUSH_SUITES = [
  "verify-turn-pipeline.mjs",
  "verify-turn-routing.mjs",
  "verify-turn-ai-classifier.mjs",
  "verify-system-health.mjs",
  "verify-unit-resolution-grounding.mjs",
  "verify-unit-name-vs-plate.mjs",
  "verify-unit-name-m600170.mjs",
  "verify-unit-name-without-m-prefix.mjs",
  "verify-unit-vs-plate-clarification.mjs",
  "verify-unit-rejection-loop.mjs",
  "verify-another-unit-consult-pivot.mjs",
  "verify-shared-plate-disambiguation.mjs",
  "verify-active-unit-memory.mjs",
  "verify-context-continuity-safety.mjs",
  "verify-ac574-reporting-thread.mjs",
  "verify-more-units-request-routing.mjs",
  "verify-odometer-plate-continuity.mjs",
  "verify-odometer-fecha-hora.mjs",
  "verify-odometer-gracias-pending-confirm.mjs",
  "verify-odometer-defer-other-query.mjs",
  "verify-ai-first-dialogue.mjs",
  "verify-certificate-flow-continuity.mjs",
  "verify-certificate-not-greeting-loop.mjs",
  "verify-certificate-flow-superseded.mjs",
  "verify-delivery-critical-fixes.mjs",
  "verify-nissan-problem-list-offer.mjs",
  "verify-brand-mention-in-question.mjs",
  "verify-platform-access-routing.mjs",
  "verify-odoo-partner-name-match.mjs",
  "verify-conversation-closing.mjs",
  "verify-atilio-reactivate-on-close.mjs",
  "verify-generic-unit-consult-and-ticket-info.mjs",
  "verify-session-unit-continuity.mjs",
  "verify-maintenance-inherits-odometer-plate.mjs",
  "verify-outbound-dedup.mjs",
  "verify-company-continuation-mention.mjs",
  "verify-utterance-understanding.mjs",
  "snapshot-turn-classification.mjs",
];

await runVerifySuites(PUSH_SUITES, { label: "pre-push (rápido)" });
