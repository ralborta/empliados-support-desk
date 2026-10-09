/**
 * Dataset de aceptación — español rioplatense / WhatsApp.
 * No es routing por regex: alimenta pruebas del cerebro LLM.
 *
 * Conteos objetivo:
 * - coloquial ≥50
 * - typos ≥20
 * - voz simulada ≥15
 * - cambios de idea ≥15
 * - referencias contextuales ≥10
 * - fechas/horas imprecisas ≥10
 */
export type RioplatenseCase = {
  id: string;
  category:
    | "colloquial"
    | "typo"
    | "voice"
    | "idea_change"
    | "contextual_ref"
    | "imprecise_datetime";
  message: string;
  /** Expectativa blanda sobre la decisión (no if de routing). */
  expect?: {
    actionIncludes?: string[];
    intentIncludes?: string[];
    reference?: string;
    dispositionKeep?: boolean;
    notAction?: string[];
  };
  notes?: string;
};

export const RIOPLATENSE_DATASET: RioplatenseCase[] = [
  // ——— Continuidad / referencias (coloquial + contextual) ———
  { id: "ref-01", category: "contextual_ref", message: "la misma", expect: { actionIncludes: ["select_entity"], reference: "selected_unit" } },
  { id: "ref-02", category: "contextual_ref", message: "esa", expect: { actionIncludes: ["select_entity", "start_intent"], reference: "selected_unit" } },
  { id: "ref-03", category: "contextual_ref", message: "esa misma", expect: { reference: "selected_unit" } },
  { id: "ref-04", category: "contextual_ref", message: "la de antes", expect: { reference: "previous_selected_unit" } },
  { id: "ref-05", category: "contextual_ref", message: "la anterior", expect: { reference: "previous_selected_unit" } },
  { id: "ref-06", category: "contextual_ref", message: "la que tenía", expect: { reference: "previous_selected_unit" } },
  { id: "ref-07", category: "contextual_ref", message: "la que estaba usando", expect: { reference: "previous_selected_unit" } },
  { id: "ref-08", category: "contextual_ref", message: "de esa unidad", expect: { reference: "selected_unit" } },
  { id: "ref-09", category: "contextual_ref", message: "sobre esa", expect: { reference: "selected_unit" } },
  { id: "ref-10", category: "contextual_ref", message: "con esa", expect: { reference: "selected_unit" } },
  { id: "ref-11", category: "colloquial", message: "seguí con esa", expect: { reference: "selected_unit" } },
  { id: "ref-12", category: "colloquial", message: "dejá esa", expect: { reference: "selected_unit" } },
  { id: "ref-13", category: "contextual_ref", message: "no esa no", expect: { reference: "previous_selected_unit" } },
  { id: "ref-14", category: "contextual_ref", message: "esa no, la otra", expect: { reference: "previous_selected_unit" } },
  { id: "ref-15", category: "contextual_ref", message: "volvé a la anterior", expect: { reference: "previous_selected_unit" } },

  // ——— Solicitudes coloquiales ———
  { id: "col-01", category: "colloquial", message: "pasame el estado", expect: { intentIncludes: ["gps"] } },
  { id: "col-02", category: "colloquial", message: "mostrame dónde está", expect: { intentIncludes: ["gps"] } },
  { id: "col-03", category: "colloquial", message: "fijate si reporta", expect: { intentIncludes: ["gps"] } },
  { id: "col-04", category: "colloquial", message: "buscame la patente AD", expect: { actionIncludes: ["select_entity", "start_intent"] } },
  { id: "col-05", category: "colloquial", message: "quiero ver esa", expect: { reference: "selected_unit" } },
  { id: "col-06", category: "colloquial", message: "decime cómo está", expect: { intentIncludes: ["gps"] } },
  { id: "col-07", category: "colloquial", message: "necesito el certificado", expect: { intentIncludes: ["certificate"] } },
  { id: "col-08", category: "colloquial", message: "sacame el certificado", expect: { intentIncludes: ["certificate"] } },
  { id: "col-09", category: "colloquial", message: "cargale el kilometraje", expect: { intentIncludes: ["odometer"] } },
  { id: "col-10", category: "colloquial", message: "cambiale el odómetro", expect: { intentIncludes: ["odometer"] } },
  { id: "col-11", category: "colloquial", message: "anotale 225663", expect: { actionIncludes: ["provide_fields", "answer_pending"] } },
  { id: "col-12", category: "colloquial", message: "mandame con alguien", expect: { intentIncludes: ["ticket", "human_handoff"] } },
  { id: "col-13", category: "colloquial", message: "pasame con un asesor", expect: { intentIncludes: ["ticket", "human_handoff"] } },
  { id: "col-14", category: "colloquial", message: "dame el reporte", expect: { intentIncludes: ["gps"] } },
  { id: "col-15", category: "colloquial", message: "che dónde está la unidad", expect: { intentIncludes: ["gps"] } },
  { id: "col-16", category: "colloquial", message: "me pasás el estado?", expect: { intentIncludes: ["gps"] } },
  { id: "col-17", category: "colloquial", message: "quiero la cobertura", expect: { intentIncludes: ["certificate"] } },
  { id: "col-18", category: "colloquial", message: "actualizame los km", expect: { intentIncludes: ["odometer"] } },
  { id: "col-19", category: "colloquial", message: "ponele 100 horas al horómetro", expect: { intentIncludes: ["horometer", "odometer"] } },
  { id: "col-20", category: "colloquial", message: "necesito mantenimiento", expect: { intentIncludes: ["maintenance"] } },
  { id: "col-21", category: "colloquial", message: "tiene un problema la unidad", expect: { intentIncludes: ["ticket", "maintenance", "gps"] } },
  { id: "col-22", category: "colloquial", message: "mostrame unidades que empiecen con AD", expect: { actionIncludes: ["select_entity", "start_intent"] } },
  { id: "col-23", category: "colloquial", message: "la segunda", expect: { actionIncludes: ["select_entity"] } },
  { id: "col-24", category: "colloquial", message: "dale", expect: { actionIncludes: ["answer_pending", "resume"] } },
  { id: "col-25", category: "colloquial", message: "listo confirmo", expect: { actionIncludes: ["answer_pending"] } },
  { id: "col-26", category: "colloquial", message: "cancelá", expect: { actionIncludes: ["answer_pending"] } },
  { id: "col-27", category: "colloquial", message: "seguimos", expect: { actionIncludes: ["resume", "answer_pending"] } },
  { id: "col-28", category: "colloquial", message: "continuemos", expect: { actionIncludes: ["resume", "answer_pending"] } },
  { id: "col-29", category: "colloquial", message: "bueno sigamos", expect: { actionIncludes: ["resume", "answer_pending"] } },
  { id: "col-30", category: "colloquial", message: "para q sirve el odometro", expect: { intentIncludes: ["domain_knowledge"] } },
  { id: "col-31", category: "colloquial", message: "q es el horometro", expect: { intentIncludes: ["domain_knowledge"] } },
  { id: "col-32", category: "colloquial", message: "por que me piden la fecha", expect: { intentIncludes: ["domain_knowledge"] } },
  { id: "col-33", category: "colloquial", message: "q podes hacer", expect: { intentIncludes: ["domain_knowledge"] } },
  { id: "col-34", category: "colloquial", message: "dejá eso", expect: { actionIncludes: ["answer_pending", "clarify"] } },
  { id: "col-35", category: "colloquial", message: "ahora no, más tarde", expect: { dispositionKeep: true } },

  // ——— Typos ———
  { id: "typ-01", category: "typo", message: "qiero un sertificado", expect: { intentIncludes: ["certificate"] } },
  { id: "typ-02", category: "typo", message: "kiero certificado", expect: { intentIncludes: ["certificate"] } },
  { id: "typ-03", category: "typo", message: "cambia el odometro", expect: { intentIncludes: ["odometer"] } },
  { id: "typ-04", category: "typo", message: "cambia el orometro", expect: { intentIncludes: ["horometer"] } },
  { id: "typ-05", category: "typo", message: "pasame la patentre", expect: { actionIncludes: ["clarify", "select_entity", "general"] } },
  { id: "typ-06", category: "typo", message: "la q tenia", expect: { reference: "previous_selected_unit" } },
  { id: "typ-07", category: "typo", message: "nose", expect: { actionIncludes: ["clarify", "general", "answer_domain_question"] } },
  { id: "typ-08", category: "typo", message: "aver el estado", expect: { intentIncludes: ["gps"] } },
  { id: "typ-09", category: "typo", message: "ahi nomas", expect: { dispositionKeep: true } },
  { id: "typ-10", category: "typo", message: "cambialo", expect: { actionIncludes: ["correct_fields", "provide_fields", "clarify"] } },
  { id: "typ-11", category: "typo", message: "pasamelo", expect: { intentIncludes: ["gps", "certificate"] } },
  { id: "typ-12", category: "typo", message: "buelbe a la anterior", expect: { reference: "previous_selected_unit" } },
  { id: "typ-13", category: "typo", message: "nesecito el sertificado", expect: { intentIncludes: ["certificate"] } },
  { id: "typ-14", category: "typo", message: "ubicacion de la unidad", expect: { intentIncludes: ["gps"] } },
  { id: "typ-15", category: "typo", message: "confirno", expect: { actionIncludes: ["answer_pending"] } },
  { id: "typ-16", category: "typo", message: "canselar", expect: { actionIncludes: ["answer_pending"] } },
  { id: "typ-17", category: "typo", message: "manteniminto", expect: { intentIncludes: ["maintenance"] } },
  { id: "typ-18", category: "typo", message: "asesor porfa", expect: { intentIncludes: ["ticket", "human_handoff"] } },
  { id: "typ-19", category: "typo", message: "kilometraje 225663", expect: { actionIncludes: ["provide_fields", "start_intent"] } },
  { id: "typ-20", category: "typo", message: "el sabado pasao", expect: { actionIncludes: ["provide_fields", "correct_fields"] } },

  // ——— Voz simulada ———
  { id: "voz-01", category: "voice", message: "no no esa no digo la anterior la que tenía antes", expect: { reference: "previous_selected_unit" } },
  { id: "voz-02", category: "voice", message: "quiero el certificado no pará antes decime dónde está", expect: { actionIncludes: ["lateral_query"], intentIncludes: ["gps"], dispositionKeep: true } },
  { id: "voz-03", category: "voice", message: "eh quiero cambiar el odómetro este el horómetro digo", expect: { intentIncludes: ["horometer", "odometer"] } },
  { id: "voz-04", category: "voice", message: "pasame el estado de la de la unidad", expect: { intentIncludes: ["gps"] } },
  { id: "voz-05", category: "voice", message: "sí sí dale confirmo", expect: { actionIncludes: ["answer_pending"] } },
  { id: "voz-06", category: "voice", message: "no espera mejor el certificado", expect: { intentIncludes: ["certificate"] } },
  { id: "voz-07", category: "voice", message: "fue anoche tipo tipo seis", expect: { actionIncludes: ["provide_fields"] } },
  { id: "voz-08", category: "voice", message: "la unidad la misma la que ya teníamos", expect: { reference: "selected_unit" } },
  { id: "voz-09", category: "voice", message: "cancelá no pará no canceles seguí", expect: { actionIncludes: ["clarify", "resume"] } },
  { id: "voz-10", category: "voice", message: "quiero quiero el reporte gps", expect: { intentIncludes: ["gps"] } },
  { id: "voz-11", category: "voice", message: "me equivoqué era la anterior", expect: { reference: "previous_selected_unit" } },
  { id: "voz-12", category: "voice", message: "anotá doscientos mil digamos 225663", expect: { actionIncludes: ["provide_fields"] } },
  { id: "voz-13", category: "voice", message: "después seguimos con esto ahora el gps", expect: { intentIncludes: ["gps"], dispositionKeep: true } },
  { id: "voz-14", category: "voice", message: "mandame con alguien humano por favor", expect: { intentIncludes: ["ticket", "human_handoff"] } },
  { id: "voz-15", category: "voice", message: "está mal la fecha digamos no fue el sábado", expect: { actionIncludes: ["correct_fields"] } },

  // ——— Cambios de idea ———
  { id: "chg-01", category: "idea_change", message: "no mejor la otra", expect: { reference: "previous_selected_unit" } },
  { id: "chg-02", category: "idea_change", message: "mejor hagamos el certificado", expect: { intentIncludes: ["certificate"] } },
  { id: "chg-03", category: "idea_change", message: "no eso no", expect: { actionIncludes: ["answer_pending", "clarify"] } },
  { id: "chg-04", category: "idea_change", message: "pará, antes decime dónde está", expect: { intentIncludes: ["gps"], dispositionKeep: true } },
  { id: "chg-05", category: "idea_change", message: "después seguimos con esto", expect: { dispositionKeep: true } },
  { id: "chg-06", category: "idea_change", message: "me equivoqué", expect: { actionIncludes: ["correct_fields", "clarify", "select_entity"] } },
  { id: "chg-07", category: "idea_change", message: "era la anterior", expect: { reference: "previous_selected_unit" } },
  { id: "chg-08", category: "idea_change", message: "quise decir odómetro", expect: { intentIncludes: ["odometer"] } },
  { id: "chg-09", category: "idea_change", message: "no, horómetro", expect: { intentIncludes: ["horometer"] } },
  { id: "chg-10", category: "idea_change", message: "no, mejor quiero odómetro", expect: { intentIncludes: ["odometer"] } },
  { id: "chg-11", category: "idea_change", message: "no quiero esa", expect: { reference: "previous_selected_unit" } },
  { id: "chg-12", category: "idea_change", message: "no era esa", expect: { reference: "previous_selected_unit" } },
  { id: "chg-13", category: "idea_change", message: "esa no", expect: { reference: "previous_selected_unit" } },
  { id: "chg-14", category: "idea_change", message: "no, la otra", expect: { reference: "previous_selected_unit" } },
  { id: "chg-15", category: "idea_change", message: "o sea, no quiero el certificado", expect: { actionIncludes: ["answer_pending", "clarify"] } },

  // ——— Fechas/horas imprecisas ———
  { id: "dt-01", category: "imprecise_datetime", message: "el sábado", expect: { actionIncludes: ["provide_fields"] } },
  { id: "dt-02", category: "imprecise_datetime", message: "el sábado pasado", expect: { actionIncludes: ["provide_fields"] } },
  { id: "dt-03", category: "imprecise_datetime", message: "ayer", expect: { actionIncludes: ["provide_fields"] } },
  { id: "dt-04", category: "imprecise_datetime", message: "anteayer", expect: { actionIncludes: ["provide_fields"] } },
  { id: "dt-05", category: "imprecise_datetime", message: "hoy a la mañana", expect: { actionIncludes: ["provide_fields", "clarify"] } },
  { id: "dt-06", category: "imprecise_datetime", message: "anoche", expect: { actionIncludes: ["provide_fields", "clarify"] } },
  { id: "dt-07", category: "imprecise_datetime", message: "tipo seis", expect: { actionIncludes: ["provide_fields"] } },
  { id: "dt-08", category: "imprecise_datetime", message: "tipo seis y media", expect: { actionIncludes: ["provide_fields"] } },
  { id: "dt-09", category: "imprecise_datetime", message: "a eso de las ocho", expect: { actionIncludes: ["provide_fields"] } },
  { id: "dt-10", category: "imprecise_datetime", message: "cerca del mediodía", expect: { actionIncludes: ["provide_fields", "clarify"] } },
  { id: "dt-11", category: "imprecise_datetime", message: "el finde", expect: { actionIncludes: ["provide_fields"] } },
  { id: "dt-12", category: "imprecise_datetime", message: "el domingo a la tardecita", expect: { actionIncludes: ["provide_fields", "clarify"] } },
  { id: "dt-13", category: "imprecise_datetime", message: "a primera hora", expect: { actionIncludes: ["provide_fields", "clarify"] } },
  { id: "dt-14", category: "imprecise_datetime", message: "después del mediodía", expect: { actionIncludes: ["provide_fields", "clarify"] } },
  { id: "dt-15", category: "imprecise_datetime", message: "fue a la tardecita", expect: { actionIncludes: ["provide_fields", "clarify"] } },

  // ——— Más coloquial para llegar a ≥50 ———
  { id: "col-36", category: "colloquial", message: "mostrame el gps", expect: { intentIncludes: ["gps"] } },
  { id: "col-37", category: "colloquial", message: "está prendida?", expect: { intentIncludes: ["gps"] } },
  { id: "col-38", category: "colloquial", message: "último reporte", expect: { intentIncludes: ["gps", "domain_knowledge"] } },
  { id: "col-39", category: "colloquial", message: "generame la póliza", expect: { intentIncludes: ["certificate"] } },
  { id: "col-40", category: "colloquial", message: "actualizá horómetro", expect: { intentIncludes: ["horometer"] } },
  { id: "col-41", category: "colloquial", message: "pedí un service", expect: { intentIncludes: ["maintenance"] } },
  { id: "col-42", category: "colloquial", message: "abrime un ticket", expect: { intentIncludes: ["ticket"] } },
  { id: "col-43", category: "colloquial", message: "listame patentes", expect: { intentIncludes: ["unit_list", "unit_search"] } },
  { id: "col-44", category: "colloquial", message: "siguiente", expect: { actionIncludes: ["select_entity", "general", "clarify"] } },
  { id: "col-45", category: "colloquial", message: "anterior", expect: { actionIncludes: ["select_entity", "general", "clarify"] } },
  { id: "col-46", category: "colloquial", message: "está mal el valor", expect: { actionIncludes: ["correct_fields"] } },
  { id: "col-47", category: "colloquial", message: "le erré al valor", expect: { actionIncludes: ["correct_fields"] } },
  { id: "col-48", category: "colloquial", message: "puse cualquier cosa", expect: { actionIncludes: ["correct_fields", "clarify"] } },
  { id: "col-49", category: "colloquial", message: "me confundí de unidad", expect: { reference: "previous_selected_unit" } },
  { id: "col-50", category: "colloquial", message: "no quiero el certificado", expect: { actionIncludes: ["answer_pending", "clarify"] } },
];

export function datasetStats(cases: RioplatenseCase[] = RIOPLATENSE_DATASET) {
  const byCat: Record<string, number> = {};
  for (const c of cases) byCat[c.category] = (byCat[c.category] ?? 0) + 1;
  return { total: cases.length, byCat };
}
