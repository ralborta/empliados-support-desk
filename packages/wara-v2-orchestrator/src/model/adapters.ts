import type { OrchestratorDecision } from "@wara-v2/contracts";
import type { TurnContext } from "../types.js";

export type ModelAdapter = {
  readonly name: string;
  decide(context: TurnContext): Promise<unknown>;
};

/** Fake determinístico: sin HTTP; decide según texto inbound. */
export class FakeModelAdapter implements ModelAdapter {
  readonly name = "fake-model";

  constructor(
    private readonly override?: (ctx: TurnContext) => unknown,
  ) {}

  async decide(context: TurnContext): Promise<unknown> {
    if (this.override) return this.override(context);
    return defaultFakeDecision(context);
  }
}

export class FailingModelAdapter implements ModelAdapter {
  readonly name = "failing-model";
  constructor(private readonly reason = "model_unavailable") {}
  async decide(): Promise<unknown> {
    throw new Error(this.reason);
  }
}

/** Devuelve JSON inválido a propósito. */
export class InvalidJsonModelAdapter implements ModelAdapter {
  readonly name = "invalid-json-model";
  async decide(): Promise<unknown> {
    return "{not-json";
  }
}

export function defaultFakeDecision(ctx: TurnContext): OrchestratorDecision {
  const text = ctx.inbound.text.trim().toLowerCase();
  const awaiting = ctx.activeOperations.find(
    (o) => o.status === "awaiting_confirmation",
  );

  if (text.includes("confirmo") || text === "si" || text === "sí") {
    return {
      schemaVersion: 2,
      interpretationSummary: "Usuario confirma operación pendiente",
      proposedGoal: awaiting
        ? mapOpTypeToGoal(awaiting.type)
        : "update_odometer",
      acts: [
        {
          act_id: "a_confirm",
          type: "confirm",
          order: 0,
          priority: 50,
          blocking: false,
          depends_on: [],
          conflicts_with: [],
          expected_effect: "none",
          confidence: 0.95,
          target: awaiting
            ? {
                operationId: awaiting.id,
                operationVersion: awaiting.operationVersion,
                payloadHash: awaiting.payloadHash,
              }
            : undefined,
        },
      ],
      responseHints: { mustNotClaimExecution: true },
    };
  }

  if (text.includes("rechazo") || text.includes("no confirmo")) {
    return {
      schemaVersion: 2,
      interpretationSummary: "Usuario rechaza confirmación",
      proposedGoal: awaiting
        ? mapOpTypeToGoal(awaiting.type)
        : "clarify",
      acts: [
        {
          act_id: "a_reject",
          type: "reject",
          order: 0,
          priority: 50,
          blocking: true,
          depends_on: [],
          conflicts_with: [],
          expected_effect: "cancel",
          confidence: 0.9,
          target: awaiting
            ? { operationId: awaiting.id }
            : undefined,
        },
      ],
    };
  }

  const odometerMatch = text.match(/od[oó]metro.*?(\d+)/i) || text.match(/(\d+)\s*km/);
  if (text.includes("odometro") || text.includes("odómetro") || odometerMatch) {
    const value = odometerMatch ? Number(odometerMatch[1]) : undefined;
    const incomplete = value === undefined;
    return {
      schemaVersion: 2,
      interpretationSummary: incomplete
        ? "Quiere actualizar odómetro pero falta valor"
        : `Quiere actualizar odómetro a ${value}`,
      proposedGoal: "update_odometer",
      acts: [
        {
          act_id: "a_new",
          type: incomplete ? "ask_question" : "new_request",
          order: 0,
          priority: 50,
          blocking: true,
          depends_on: [],
          conflicts_with: [],
          expected_effect: incomplete ? "clarify" : "prepare",
          confidence: 0.85,
          payload: incomplete
            ? undefined
            : {
                value_number: value,
                unit_label: ctx.conversation.activeUnitId ?? undefined,
              },
          target: {
            companyId: ctx.conversation.activeCompanyId ?? undefined,
            unitId: ctx.conversation.activeUnitId ?? undefined,
            goal: "update_odometer",
          },
        },
        ...(incomplete
          ? []
          : [
              {
                act_id: "a_data",
                type: "provide_data" as const,
                order: 1,
                priority: 40,
                blocking: false,
                depends_on: ["a_new"],
                conflicts_with: [],
                expected_effect: "prepare" as const,
                confidence: 0.85,
                payload: { value_number: value! },
              },
            ]),
      ],
      toolHints: incomplete
        ? undefined
        : [
            {
              name: "prepare_odometer_update",
              arguments: {
                company_id: ctx.conversation.activeCompanyId ?? undefined,
                unit_id: ctx.conversation.activeUnitId ?? undefined,
                value,
              },
              reason: "sugerencia prepare",
              related_act_id: "a_new",
            },
          ],
      responseHints: {
        mustAsk: incomplete ? ["¿Cuál es el valor del odómetro?"] : undefined,
        mustNotClaimExecution: true,
      },
    };
  }

  if (text.includes("capacidad") || text.includes("que podes") || text.includes("qué podés")) {
    return {
      schemaVersion: 2,
      interpretationSummary: "Consulta de capacidades",
      proposedGoal: "list_capabilities",
      acts: [
        {
          act_id: "a_cap",
          type: "ask_question",
          order: 0,
          priority: 30,
          blocking: false,
          depends_on: [],
          conflicts_with: [],
          expected_effect: "none",
          confidence: 0.8,
        },
      ],
      toolHints: [
        {
          name: "list_capabilities",
          arguments: {},
          reason: "listar capacidades",
        },
      ],
    };
  }

  return {
    schemaVersion: 2,
    interpretationSummary: "Mensaje general / unclear",
    proposedGoal: "clarify",
    acts: [
      {
        act_id: "a_unclear",
        type: "unclear",
        order: 0,
        priority: 10,
        blocking: false,
        depends_on: [],
        conflicts_with: [],
        expected_effect: "clarify",
        confidence: 0.4,
      },
    ],
    responseHints: {
      mustAsk: ["¿En qué te puedo ayudar?"],
      mustNotClaimExecution: true,
    },
  };
}

function mapOpTypeToGoal(
  type: OperationRecordType,
): OrchestratorDecision["proposedGoal"] {
  switch (type) {
    case "update_odometer":
      return "update_odometer";
    case "issue_certificate":
      return "issue_certificate";
    case "create_maintenance":
      return "create_maintenance";
    case "odoo_ticket":
      return "odoo_ticket";
  }
}

type OperationRecordType =
  | "update_odometer"
  | "issue_certificate"
  | "create_maintenance"
  | "odoo_ticket";
