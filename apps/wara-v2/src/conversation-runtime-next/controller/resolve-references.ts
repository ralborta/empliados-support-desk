import type { EntityReference } from "../../commander-v3/types/refs.js";
import type { ContextualReference, TurnInterpretation } from "../types/interpretation.js";
import type { ConversationStateVNext } from "./vnext-types.js";

export type ResolvedReferences = {
  unitReference?: EntityReference;
  companyReference?: EntityReference;
  clarifyQuestion?: string;
};

function normExpr(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function refToUnitEntity(
  ref: ContextualReference,
  state: ConversationStateVNext,
): ResolvedReferences {
  const expr = normExpr(ref.expression);
  const source = ref.source ?? "message";

  if (ref.type === "index" || ref.index != null) {
    const n = ref.index ?? Number.parseInt(ref.expression, 10);
    if (Number.isFinite(n) && n > 0) {
      const listing = state.lastPresented.units;
      const item = listing?.items.find((i) => i.index === n);
      if (item?.movilId != null) {
        return {
          unitReference: {
            kind: "unit",
            mode: "index",
            value: String(n),
            reference: "listed",
          },
        };
      }
      if (listing && n <= listing.items.length) {
        return {
          unitReference: {
            kind: "unit",
            mode: "index",
            value: String(n),
            reference: "listed",
          },
        };
      }
      return { clarifyQuestion: "No encuentro ese número en la lista. ¿Cuál es?" };
    }
  }

  if (
    source === "active" ||
    /^(la misma|esa|esta|la activa|activa|misma unidad)$/.test(expr) ||
    expr === "esa unidad"
  ) {
    if (state.unit) {
      return {
        unitReference: {
          kind: "unit",
          mode: "contextual",
          value: "active",
          reference: "active",
        },
      };
    }
    return { clarifyQuestion: "No hay unidad activa. ¿Cuál patente o código?" };
  }

  if (
    source === "previous" ||
    /^(la anterior|anterior|la otra|otra unidad|previous)$/.test(expr)
  ) {
    if (state.previousUnit) {
      return {
        unitReference: {
          kind: "unit",
          mode: "contextual",
          value: "previous",
          reference: "previous",
        },
      };
    }
    return { clarifyQuestion: "No tengo una unidad anterior en este hilo." };
  }

  if (ref.type === "unit" && ref.expression.trim()) {
    return {
      unitReference: {
        kind: "unit",
        mode: "plate",
        value: ref.expression.trim(),
      },
    };
  }

  return {};
}

function refToCompanyEntity(
  ref: ContextualReference,
  state: ConversationStateVNext,
): ResolvedReferences {
  const expr = normExpr(ref.expression);
  const source = ref.source ?? "message";

  if (
    source === "active" ||
    /^(empresa activa|mi empresa|la empresa activa)$/.test(expr)
  ) {
    if (state.company) {
      return {
        companyReference: {
          kind: "company",
          mode: "contextual",
          value: state.company.name,
          reference: "active",
        },
      };
    }
    return { clarifyQuestion: "Todavía no hay empresa activa. ¿Cuál elegís?" };
  }

  if (ref.type === "index" || ref.index != null) {
    const n = ref.index ?? Number.parseInt(ref.expression, 10);
    if (Number.isFinite(n) && n > 0) {
      const listing = state.lastPresented.companies;
      const item = listing?.items.find((i) => i.index === n);
      if (item?.companyId) {
        return {
          companyReference: {
            kind: "company",
            mode: "index",
            value: String(n),
            reference: "listed",
          },
        };
      }
      const company = state.availableCompanies[n - 1];
      if (company) {
        return {
          companyReference: {
            kind: "company",
            mode: "index",
            value: String(n),
            reference: "listed",
          },
        };
      }
      return { clarifyQuestion: "No encuentro esa empresa en la lista." };
    }
  }

  if (ref.type === "company" && ref.expression.trim()) {
    return {
      companyReference: {
        kind: "company",
        mode: "named",
        value: ref.expression.trim(),
      },
    };
  }

  return {};
}

export function resolveInterpretationReferences(
  interpretation: TurnInterpretation,
  state: ConversationStateVNext,
): ResolvedReferences {
  let unitReference: EntityReference | undefined;
  let companyReference: EntityReference | undefined;
  let clarifyQuestion: string | undefined;

  for (const ref of interpretation.references) {
    if (ref.type === "unit" || ref.type === "index" && state.lastPresented.units) {
      const r = refToUnitEntity(ref, state);
      if (r.clarifyQuestion) clarifyQuestion = r.clarifyQuestion;
      if (r.unitReference) unitReference = r.unitReference;
    }
    if (ref.type === "company" || ref.type === "index" && state.lastPresented.companies) {
      const r = refToCompanyEntity(ref, state);
      if (r.clarifyQuestion && !clarifyQuestion) clarifyQuestion = r.clarifyQuestion;
      if (r.companyReference) companyReference = r.companyReference;
    }
  }

  for (const req of interpretation.requests) {
    const entities = req.entities ?? {};
    if (entities.movilId != null) {
      unitReference = {
        kind: "unit",
        mode: "id",
        value: String(entities.movilId),
      };
    }
    if (entities.companyId != null) {
      companyReference = {
        kind: "company",
        mode: "id",
        value: String(entities.companyId),
      };
    }
    if (entities.index != null) {
      const n = Number(entities.index);
      if (req.domain === "company") {
        companyReference = {
          kind: "company",
          mode: "index",
          value: String(n),
          reference: "listed",
        };
      } else if (req.domain === "unit" || req.domain === "gps") {
        unitReference = {
          kind: "unit",
          mode: "index",
          value: String(n),
          reference: "listed",
        };
      }
    }
  }

  return { unitReference, companyReference, clarifyQuestion };
}
