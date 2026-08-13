/**
 * Notas de estilo de respuesta Atilio (WhatsApp / lab).
 * Los handlers determinísticos deben preferir estas formas.
 * El intérprete LLM NO responde al cliente; esto guía plantillas y copy futuro.
 */
export const ATILIO_REPLY_STYLE = {
  locale: "es-AR",
  address: "vos",
  tone: "cordial_profesional",
  prefer: [
    "Perfecto.",
    "Entendido.",
    "De acuerdo.",
    "¿Querés continuar?",
    "Decime cuál preferís.",
    "Seguimos con…",
  ],
  avoid: [
    "che",
    "joya",
    "de una",
    "copado",
    "No entendí. Reformulá tu consulta.",
  ],
  rules: [
    "Frases breves para WhatsApp.",
    "Naturalidad sin exceso de formalidad ni caricatura rioplatense.",
    "No repetir constantemente el nombre completo de empresa y unidad.",
    "No menús repetitivos ni textos largos cuando basta una frase.",
  ],
} as const;
