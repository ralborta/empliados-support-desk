import type { PlatformKnowledgeInterpret } from "@/lib/infoGuideInterpretAI";

export const CERTIFICATE_DEFINITION_REPLY =
  "El certificado de cobertura es el documento que acredita la cobertura de una unidad en Wara. " +
  "Se solicita para una unidad concreta; pedir información sobre él no inicia ni genera el trámite.";

/**
 * Excepción informativa tipada para el dominio certificado.
 *
 * El router de operaciones reconoce cualquier mención de certificado para proteger la
 * emisión real. Sólo una decisión semántica explícita de definición, sin pedido de
 * ejecución, puede convertir ese candidato operativo en una lectura informativa.
 */
export function shouldRouteCertificateDefinitionToGuide(input: {
  interpret: PlatformKnowledgeInterpret | null | undefined;
  rulesExecutor: string;
}): boolean {
  const { interpret, rulesExecutor } = input;
  return (
    rulesExecutor === "certificados" &&
    interpret?.route === "info_guides" &&
    interpret.need === "definition" &&
    interpret.executionRequest === false
  );
}
