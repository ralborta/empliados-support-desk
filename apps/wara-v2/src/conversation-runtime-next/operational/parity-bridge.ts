import { enrichPlanForCompanyChange } from "../../commander-v3/enrich/company-change.js";
import {
  enrichPlanForCompanyCapture,
} from "../../commander-v3/enrich/company-capture.js";
import {
  enrichPlanForExpectedFields,
  enrichPlanForMeterValueFallback,
} from "../../commander-v3/enrich/expected-field-capture.js";
import {
  enrichPlanForConfirmationOutcome,
} from "../../commander-v3/enrich/confirmation-outcome.js";
import {
  resolveCompanyReference,
} from "../../commander-v3/entities/resolve.js";
import { isAwaitingWriteConfirmation } from "../controller/confirmation-guard.js";
import { planFromDecision } from "../controller/plan-from-decision.js";
import { resolveInterpretationReferences } from "../controller/resolve-references.js";
import {
  mergeOperationalPlanIntoDecision,
  resolvedEntitiesFromPlan,
} from "./merge-plan.js";
import {
  assessExpectedInputCaptureEligibility,
} from "./expected-input-capture-gate.js";
import {
  previewUnitResolution,
  unresolvedFromUnitPreview,
} from "./unit-resolution-preview.js";
import type {
  OperationalResolutionInput,
  OperationalResolutionResult,
  OperationalFact,
} from "./types.js";

/**
 * Bridge de paridad operativa: reutiliza enrichers determinísticos V3
 * sin delegar autoridad conversacional al Commander legacy.
 */
export function applyOperationalParityBridge(
  input: OperationalResolutionInput,
): OperationalResolutionResult {
  const enrichersApplied: string[] = [];
  const operationalFacts: OperationalFact[] = [];

  let plan = planFromDecision({
    decision: input.decision,
    interpretation: input.interpretation,
  });

  const expectedCapture = assessExpectedInputCaptureEligibility({
    interpretation: input.interpretation,
    decision: input.decision,
    vnext: input.vnext,
    stateLastQuestionExpected: input.state.lastQuestion?.expected,
  });
  const hasExpectedField = expectedCapture.expectedField != null;
  const mayCaptureExpected = !hasExpectedField || expectedCapture.eligible;

  const expectedField = expectedCapture.expectedField ?? undefined;

  let contextualUnitRef: ReturnType<typeof resolveInterpretationReferences>["unitReference"];
  if (mayCaptureExpected && expectedField === "unit") {
    const synth = resolveInterpretationReferences(
      {
        ...input.interpretation,
        references: [
          {
            type: "unit",
            expression: input.message.trim(),
            source: "message",
          },
        ],
      },
      input.vnext,
    );
    if (
      synth.unitReference &&
      (synth.unitReference.mode === "contextual" ||
        synth.unitReference.reference === "active" ||
        synth.unitReference.reference === "previous")
    ) {
      contextualUnitRef = synth.unitReference;
    }
  }

  const beforeCaps = JSON.stringify(plan.requestedCapabilities);

  plan = enrichPlanForCompanyChange(plan, input.state, input.message);
  if (JSON.stringify(plan.requestedCapabilities) !== beforeCaps) {
    enrichersApplied.push("enrichPlanForCompanyChange");
  }

  const beforeCapture = JSON.stringify(plan.requestedCapabilities);
  if (mayCaptureExpected) {
    plan = enrichPlanForCompanyCapture(plan, input.state, input.message);
  }
  if (JSON.stringify(plan.requestedCapabilities) !== beforeCapture) {
    enrichersApplied.push("enrichPlanForCompanyCapture");
  }

  const beforeExpected = JSON.stringify(plan);
  if (mayCaptureExpected) {
    if (contextualUnitRef) {
      plan = enrichPlanForExpectedFields(
        { ...plan, unitReference: contextualUnitRef },
        input.state,
        input.message,
      );
      if (!plan.unitReference || plan.unitReference.mode !== "contextual") {
        plan = {
          ...plan,
          unitReference: contextualUnitRef,
          requestedCapabilities: plan.requestedCapabilities.some(
            (c) => c.name === "unit.select",
          )
            ? plan.requestedCapabilities
            : [...plan.requestedCapabilities, { name: "unit.select", params: {} }],
        };
      }
      enrichersApplied.push("expectedUnitContextual");
    } else {
      plan = enrichPlanForExpectedFields(plan, input.state, input.message);
    }
    if (JSON.stringify(plan) !== beforeExpected) {
      enrichersApplied.push("enrichPlanForExpectedFields");
    }

    if (expectedField === "company" && !plan.companyReference) {
      const synth = resolveInterpretationReferences(
        {
          ...input.interpretation,
          references: [
            ...input.interpretation.references,
            {
              type: "company",
              expression: input.message.trim(),
              source: "message",
            },
          ],
        },
        input.vnext,
      );
      if (synth.companyReference) {
        const beforeSynth = JSON.stringify(plan);
        plan = enrichPlanForCompanyCapture(
          {
            ...plan,
            companyReference: synth.companyReference,
          },
          input.state,
          input.message,
        );
        if (JSON.stringify(plan) !== beforeSynth) {
          enrichersApplied.push("expectedCompanyContextual");
        }
      }
    }
  }

  const beforeMeter = JSON.stringify(plan);
  if (mayCaptureExpected) {
    plan = enrichPlanForMeterValueFallback(plan, input.state, input.message);
  }
  if (JSON.stringify(plan) !== beforeMeter) {
    enrichersApplied.push("enrichPlanForMeterValueFallback");
  }

  if (isAwaitingWriteConfirmation(input.state) && mayCaptureExpected) {
    const beforeConfirm = JSON.stringify(plan);
    plan = enrichPlanForConfirmationOutcome(plan, input.state, input.message);
    if (JSON.stringify(plan) !== beforeConfirm) {
      enrichersApplied.push("enrichPlanForConfirmationOutcome");
    }
  }

  const unresolved: OperationalResolutionResult["unresolved"] = [];

  const expectedFieldResolved =
    expectedCapture.eligible ? expectedCapture.expectedField : null;

  if (expectedFieldResolved === "unit" && plan.unitReference) {
    const preview = previewUnitResolution(plan.unitReference, input.state);
    const u = unresolvedFromUnitPreview(preview, true);
    if (u) {
      unresolved.push(u);
      if (u.status === "not_found") {
        operationalFacts.push({
          kind: "resolution",
          source: "resolveUnitReference",
          text: `No encontré una unidad con el identificador «${u.query ?? input.message.trim()}».`,
        });
        plan = {
          ...plan,
          requestedCapabilities: plan.requestedCapabilities.filter(
            (c) => c.name !== "unit.select",
          ),
        };
      } else if (u.status === "ambiguous") {
        operationalFacts.push({
          kind: "resolution",
          source: "resolveUnitReference",
          text: `Hay varias unidades que coinciden. Decime el número del listado o el identificador exacto.`,
        });
      }
    } else if (preview.statusKind === "resolved" && preview.unit) {
      operationalFacts.push({
        kind: "resolution",
        source: "resolveUnitReference",
        text: `Unidad resuelta: ${preview.unit.label}`,
      });
    }
  }

  if (expectedFieldResolved === "company" && plan.companyReference) {
    const companyPreview = resolveCompanyReference(plan.companyReference, input.state);
    if (companyPreview.status === "not_found") {
      plan = {
        ...plan,
        requestedCapabilities: plan.requestedCapabilities.filter(
          (c) => c.name !== "company.select",
        ),
      };
      unresolved.push({
        field: "company",
        status: "not_found",
        query: companyPreview.query,
      });
      operationalFacts.push({
        kind: "resolution",
        source: "resolveCompanyReference",
        text: `No encontré esa empresa en el listado. ¿Cuál elegís?`,
      });
    } else if (companyPreview.status === "many") {
      unresolved.push({
        field: "company",
        status: "ambiguous",
        query: companyPreview.query,
      });
    }
  }

  const explicitCompanyChange = plan.requestedCapabilities.some(
    (c) => c.name === "company.list",
  );
  const decision =
    hasExpectedField && !expectedCapture.eligible && !explicitCompanyChange
      ? input.decision
      : mergeOperationalPlanIntoDecision(input.decision, plan);
  const resolvedEntities = resolvedEntitiesFromPlan(plan);

  if (expectedFieldResolved === "unit" && plan.unitReference) {
    const preview = previewUnitResolution(plan.unitReference, input.state);
    if (preview.statusKind === "resolved" && preview.unit) {
      resolvedEntities.unitId = preview.unit.movilId;
      resolvedEntities.unitLabel = preview.unit.label;
    }
  }

  if (
    plan.requestedCapabilities.some((c) => c.name === "company.select") &&
    plan.companyReference &&
    !unresolved.some((u) => u.field === "company")
  ) {
    operationalFacts.push({
      kind: "resolution",
      source: "company.select",
      text: "Selección de empresa aplicada.",
    });
  }

  return {
    decision,
    resolvedEntities,
    capabilityRequests: decision.authorizedCapabilities,
    operationalFacts,
    unresolved,
    enrichersApplied,
    expectedCapture,
  };
}
