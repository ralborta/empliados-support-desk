import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

export interface ConversationMessage {
  from: string; // 'CUSTOMER' | 'BOT' | 'HUMAN'
  text: string;
  createdAt: Date;
}

/**
 * Resume una conversación completa en 2-3 líneas usando OpenAI
 */
export async function summarizeConversation(
  messages: ConversationMessage[]
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY no configurada');
  }

  if (messages.length === 0) {
    return 'Sin mensajes';
  }

  // Formatear la conversación para OpenAI
  const conversationText = messages
    .map((msg) => `[${msg.from}]: ${msg.text}`)
    .join('\n');

  const prompt = `Eres un asistente de soporte técnico. Resume la siguiente conversación en máximo 2-3 líneas, enfocándote en:
1. El problema principal del cliente
2. Información clave mencionada
3. Urgencia o impacto

Conversación:
${conversationText}

Resumen conciso:`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Modelo más económico y rápido
      messages: [
        {
          role: 'system',
          content:
            'Eres un asistente experto en resumir conversaciones de soporte técnico de forma concisa y clara.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3, // Más determinístico
      max_tokens: 150, // Límite para mantenerlo conciso
    });

    const summary = response.choices[0]?.message?.content?.trim() || 'Error al generar resumen';
    console.log('[OpenAI] Resumen generado:', summary);
    return summary;
  } catch (error: any) {
    console.error('[OpenAI] Error al resumir:', error.message);
    // Fallback: tomar los primeros mensajes
    return messages.slice(0, 3).map((m) => m.text).join(' | ');
  }
}

/**
 * Genera una conclusión de cómo se resolvió el caso
 */
export async function generateResolution(
  messages: ConversationMessage[],
  wasResolvedByAI: boolean
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    return wasResolvedByAI
      ? 'Resuelto automáticamente por IA'
      : 'Escalado a soporte humano';
  }

  if (messages.length === 0) {
    return 'Sin resolución registrada';
  }

  const conversationText = messages
    .map((msg) => `[${msg.from}]: ${msg.text}`)
    .join('\n');

  const prompt = `Resume cómo se resolvió este caso de soporte en 1-2 líneas:

Conversación:
${conversationText}

${wasResolvedByAI ? 'El caso fue resuelto automáticamente por IA.' : 'El caso fue escalado a un agente humano.'}

Conclusión:`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Eres un asistente que genera conclusiones claras de casos de soporte.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 100,
    });

    const resolution = response.choices[0]?.message?.content?.trim() || 'Sin resolución';
    console.log('[OpenAI] Resolución generada:', resolution);
    return resolution;
  } catch (error: any) {
    console.error('[OpenAI] Error al generar resolución:', error.message);
    return wasResolvedByAI
      ? 'Resuelto automáticamente por IA'
      : 'Escalado a soporte humano';
  }
}
