import OpenAI from "openai";
import {
  ensureOdooCaseRefInClientMessage,
  formatCustomerOdooCaseRefForWhatsApp,
} from "@/lib/customerOdooCaseRef";
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
  /** True solo si el caso Odoo ya existía (no si apenas se creó). */
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
        ? ` Ese caso ya estaba abierto (*${display}*); no generé uno nuevo. Un asesor de Atención al cliente lo sigue revisando.`
        : ` Generé el caso *${display}* en Atención al cliente. Un asesor lo va a revisar.`;
      return `La unidad ${unitLabel} presenta ${ticketIssueDetail}.${casePart}`;
    }
    const ticketPart = ticketRef
      ? ticketReused
        ? " Ya tenías un caso abierto para esta unidad; registré la consulta ahí. Un asesor de Atención al cliente lo sigue revisando."
        : " Generé un caso para que Atención al cliente lo revise (todavía no tengo el número para pasarte)."
      : "";
    return `La unidad ${unitLabel} presenta ${ticketIssueDetail}.${ticketPart}`;
  }

  return `Consulta de ${unitLabel}.`;
}

export async function buildGpsClientSummary(input: GpsSummaryInput): Promise<string> {
  const template = buildTemplateSummary(input);
  const finalize = (text: string) =>
    ensureOdooCaseRefInClientMessage(text, input.odooRef, { reused: input.ticketReused });

  if (!process.env.OPENAI_API_KEY?.trim()) return finalize(template);

  const facts = buildGpsFacts(input.unit, input.assessment);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const odooDisplay = input.odooRef
    ? formatCustomerOdooCaseRefForWhatsApp(input.odooRef)
    : null;

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
                "Si hay numero_caso_odoo, OBLIGATORIO incluirlo exacto (ej. *#36248*). " +
                "Si caso_reutilizado=true: dejá claro que el caso YA ESTABA abierto y NO generaste uno nuevo. " +
                "Si caso_reutilizado=false y hay numero_caso_odoo: dejá claro que GENERASTE ese caso ahora. " +
                "Nunca digas solo «hay un caso abierto» sin aclarar si es nuevo o previo, ni omitas el número si existe. " +
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
                numero_caso_odoo: odooDisplay,
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
    if (!response) return finalize(template);

    const text = response.choices[0]?.message?.content?.trim();
    if (!text || text.length < 40) return finalize(template);
    // Si la IA omitió el #Odoo, preferimos plantilla (ya lo trae) + reinyección.
    if (odooDisplay && !text.includes(odooDisplay.replace(/^#/, "")) && !text.includes(odooDisplay)) {
      return finalize(template);
    }
    return finalize(text);
  } catch (error) {
    console.warn("[waraGpsSummary] IA falló, uso plantilla:", error instanceof Error ? error.message : error);
    return finalize(template);
  }
}

export { buildTemplateSummary, ignitionLabel, formatMinutesAgo };
