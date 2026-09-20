import type { PlatformKnowledgeInterpret } from "@/lib/infoGuideInterpretAI";

export const ODOMETER_INFORMATION_DEFINITION_REPLY =
  "El odómetro registra los kilómetros de la unidad; el horómetro, las horas de uso del motor. " +
  "En Wara se consultan y actualizan por unidad. Preguntar qué son no inicia el trámite de carga.";

export const ODOMETER_INFORMATION_PROCEDURE_REPLY =
  "Para actualizar odómetro u horómetro por este chat: indicá la unidad (patente o nombre) y el valor en km o horas. " +
  "También podés cargarlo en la app desde el módulo correspondiente. Pedir la explicación no confirma ningún valor.";

export const ODOMETER_INFORMATION_AMBIGUOUS_CLARIFY =
  "¿Querés saber qué es el odómetro/horómetro o actualizar el valor de una unidad?";

/**
 * Excepción informativa tipada para odómetro/horómetro.
 *
 * El router operativo trata cualquier mención de odómetro como candidato de trámite.
 * Sólo un destino tipado `odometer_information` con executionRequest=false puede
 * convertir ese candidato en lectura informativa sin abrir el flujo de escritura.
 */
export function shouldRouteOdometerInformationToGuide(input: {
  interpret: PlatformKnowledgeInterpret | null | undefined;
  rulesExecutor: string;
}): boolean {
  const { interpret, rulesExecutor } = input;
  return (
    rulesExecutor === "odometro" &&
    interpret?.route === "info_guides" &&
    interpret.normalTarget === "odometer_information" &&
    interpret.executionRequest === false &&
    (interpret.need === "definition" ||
      interpret.need === "procedure" ||
      interpret.need === "ambiguous")
  );
}

export function isOdometerInformationInterpret(
  interpret: PlatformKnowledgeInterpret | null | undefined,
): boolean {
  return interpret?.normalTarget === "odometer_information";
}

export function replyForOdometerInformation(
  interpret: PlatformKnowledgeInterpret | null | undefined,
): string {
  if (interpret?.need === "ambiguous" && interpret.clarifyQuestion) {
    return interpret.clarifyQuestion;
  }
  if (interpret?.need === "procedure") {
    return ODOMETER_INFORMATION_PROCEDURE_REPLY;
  }
  return ODOMETER_INFORMATION_DEFINITION_REPLY;
}
