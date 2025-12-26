export type ActionPlan = {
  replyText: string;
  setStatus?: string;
  priority?: string;
  assignTo?: string;
  needsHuman: boolean;
  suggestedInternalNote?: string;
  nextQuestions?: string[];
};

export function neutralActionPlan(): ActionPlan {
  return {
    replyText:
      "Hemos recibido tu mensaje y lo estamos revisando. Te avisaremos en breve.",
    needsHuman: false,
  };
}

export function escalationActionPlan(): ActionPlan {
  return {
    replyText: "Ya lo derivé al equipo. Te respondo en breve. ¿Me confirmas algún dato adicional?",
    setStatus: "IN_PROGRESS",
    needsHuman: true,
    suggestedInternalNote: "Escalado por señal de urgencia/enojo detectada.",
  };
}

export function autoReplyActionPlan(nextQuestions?: string[]): ActionPlan {
  return {
    replyText:
      "Entendido. Para ayudarte rápido necesito: (1) nombre del agente, (2) canal, (3) error exacto. Mientras, valida webhook/env/logs.",
    setStatus: "WAITING_CUSTOMER",
    needsHuman: false,
    nextQuestions,
    suggestedInternalNote: "Auto-reply con checklist inicial enviado al cliente.",
  };
}
