import OpenAI from "openai";
import { formatCustomerOdooCaseRefForWhatsApp } from "@/lib/customerOdooCaseRef";
import type { WaraUnidadEstado } from "@/lib/waraApi";
import { withOpenAiTimeout } from "@/lib/openaiTimeout";
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
  odooRef?: string;
  ticketReused?: boolean;
  ticketIssueDetail?: string;
};

function buildTemplateSummary(input: GpsSummaryInput): string {
  const { unitLabel, unit, assessment, action, ticketRef, odooRef, ticketReused, ticketIssueDetail } =
    input;
  const facts = buildGpsFacts(unit, assessment);

  if (assessment.status === "ok") {
    return (
      `Funcionamiento normal: la unidad ${unitLabel} envía reporte y posición actualizados` +
      (facts.ignicionEstado === "encendida"
        ? `; la ignición está encendida (puede llevar rato en ON sin cambiar de estado). `
        : ` y la ignición acompaña. `) +
      `No genero ticket. Si algo cambia, volvé a consultar.`
    );
  }

  if (assessment.status === "coherent_pause") {
    const reportRecent = assessment.reportElapsed < MISSING_REPORT_TICKET_THRESHOLD_SECONDS;
    const pauseReason = reportRecent
      ? "La ignición está apagada y la última posición coincide con ese apagado: la unidad está detenida y es normal que no actualice posición aunque el reporte sea reciente."
      : "El reporte, la posición y la ignición apagada van alineados en el tiempo.";
    return (
      `La unidad ${unitLabel} está detenida. ` +
      `${pauseReason} No genero ticket por ahora. Si algo cambia, volvé a consultar.`
    );
  }

  if (action === "ticket" && ticketIssueDetail) {
    if (odooRef) {
      const display = formatCustomerOdooCaseRefForWhatsApp(odooRef);
      const casePart = ticketReused
        ? ` Ya hay un caso en revisión (*${display}*).`
        : ` Tu caso es *${display}*. Un asesor de Atención al cliente lo va a revisar.`;
      return `La unidad ${unitLabel} presenta ${ticketIssueDetail}.${casePart}`;
    }
    const ticketPart = ticketRef
      ? ticketReused
        ? " Ya hay un caso abierto y Atención al cliente lo va a revisar."
        : " Generé un caso para que Atención al cliente lo revise."
      : "";
    return `La unidad ${unitLabel} presenta ${ticketIssueDetail}.${ticketPart}`;
  }

  return `Consulta de ${unitLabel}.`;
}

export async function buildGpsClientSummary(input: GpsSummaryInput): Promise<string> {
  const template = buildTemplateSummary(input);
  if (!process.env.OPENAI_API_KEY?.trim()) return template;

  const facts = buildGpsFacts(input.unit, input.assessment);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const response = await withOpenAiTimeout((signal) =>
      openai.chat.completions.create(
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "Redactás respuestas de WhatsApp para mesa de ayuda Wara GPS. " +
                "Mantené los hechos (estado general, ignición, si se generó caso o no, acción) sin tiempos técnicos crudos ni segundos. " +
                "No menciones intervalos de reporte del GPS. No inventes datos. " +
                "Si hay numero_caso_odoo en los datos, incluí «Tu caso es #…» con ese número exacto (solo referencia Odoo). " +
                "Si no hay numero_caso_odoo, no inventes ni menciones números de caso. " +
                "Español rioplatense, 2-4 oraciones, sin emojis.",
            },
            {
              role: "user",
              content: JSON.stringify({
                plantilla_base: template,
                hechos_obligatorios: facts,
                accion: input.action,
                se_genero_caso: !!(input.odooRef ?? input.ticketRef),
                numero_caso_odoo: input.odooRef
                  ? formatCustomerOdooCaseRefForWhatsApp(input.odooRef)
                  : null,
                caso_reutilizado: input.ticketReused ?? false,
                detalle_ticket: input.ticketIssueDetail ?? null,
              }),
            },
          ],
          temperature: 0.2,
          max_tokens: 280,
        },
        { signal },
      ),
    );
    if (!response) return template;

    const text = response.choices[0]?.message?.content?.trim();
    return text && text.length >= 40 ? text : template;
  } catch (error) {
    console.warn("[waraGpsSummary] IA falló, uso plantilla:", error instanceof Error ? error.message : error);
    return template;
  }
}

export { buildTemplateSummary, ignitionLabel, formatMinutesAgo };
