import OpenAI from "openai";
import type { WaraUnidadEstado } from "@/lib/waraApi";
import {
  buildGpsFacts,
  formatMinutesAgo,
  ignitionLabel,
  MISSING_REPORT_TICKET_THRESHOLD_SECONDS,
  type GpsAssessment,
} from "@/lib/waraGpsAssessment";

export type GpsSummaryInput = {
  unitLabel: string;
  unit: WaraUnidadEstado;
  assessment: GpsAssessment;
  action: "none" | "observation" | "ticket";
  ticketRef?: string;
  ticketIssueDetail?: string;
};

function buildTemplateSummary(input: GpsSummaryInput): string {
  const { unitLabel, unit, assessment, action, ticketRef, ticketIssueDetail } = input;
  const facts = buildGpsFacts(unit, assessment);
  const telemetryLine = `Reporte hace ${facts.reporte}, posición hace ${facts.posicion}, ignición ${facts.ignicionEstado} (hace ${facts.ignicion}).`;

  if (assessment.status === "ok") {
    return (
      `Funcionamiento normal: la unidad ${unitLabel} envía reporte y posición actualizados` +
      (facts.ignicionEstado === "encendida"
        ? `; la ignición está encendida (puede llevar rato en ON sin cambiar de estado). `
        : ` y la ignición acompaña. `) +
      `${telemetryLine} No genero ticket. El GPS puede reportar cada 10 minutos; si algo cambia, volvé a consultar.`
    );
  }

  if (assessment.status === "coherent_pause") {
    const reportRecent = assessment.reportElapsed < MISSING_REPORT_TICKET_THRESHOLD_SECONDS;
    const pauseReason = reportRecent
      ? "La ignición está apagada y la última posición coincide con ese apagado: la unidad está detenida y es normal que no actualice posición aunque el reporte sea reciente."
      : "El reporte, la posición y la ignición apagada van alineados en el tiempo.";
    return (
      `La unidad ${unitLabel} está detenida: ${telemetryLine} ` +
      `${pauseReason} No genero ticket por ahora. Si algo cambia, volvé a consultar.`
    );
  }

  if (action === "ticket" && ticketIssueDetail) {
    const ticketPart = ticketRef
      ? ` Generé el caso ${ticketRef.startsWith("TCK-") ? ticketRef : `N° ${ticketRef}`} para que Atención al cliente lo revise.`
      : "";
    return `La unidad ${unitLabel} presenta ${ticketIssueDetail}. ${telemetryLine}${ticketPart}`;
  }

  return `Consulta de ${unitLabel}. ${telemetryLine}`;
}

export async function buildGpsClientSummary(input: GpsSummaryInput): Promise<string> {
  const template = buildTemplateSummary(input);
  if (!process.env.OPENAI_API_KEY?.trim()) return template;

  const facts = buildGpsFacts(input.unit, input.assessment);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Redactás respuestas de WhatsApp para mesa de ayuda Wara GPS. " +
            "Mantené EXACTOS los hechos (tiempos, ignición, ticket, acción). " +
            "No inventes datos. No cambies si hay ticket o no. Español rioplatense, 2-4 oraciones, sin emojis.",
        },
        {
          role: "user",
          content: JSON.stringify({
            plantilla_base: template,
            hechos_obligatorios: facts,
            accion: input.action,
            ticket: input.ticketRef ?? null,
            detalle_ticket: input.ticketIssueDetail ?? null,
          }),
        },
      ],
      temperature: 0.2,
      max_tokens: 280,
    });

    const text = response.choices[0]?.message?.content?.trim();
    return text && text.length >= 40 ? text : template;
  } catch (error) {
    console.warn("[waraGpsSummary] IA falló, uso plantilla:", error instanceof Error ? error.message : error);
    return template;
  }
}

export { buildTemplateSummary, ignitionLabel, formatMinutesAgo };
