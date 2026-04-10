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

  const prompt = `Eres un asistente operativo de mesa de ayuda Wara. Resume la conversación en este formato exacto de 4 líneas:
Motivo: ...
Datos clave capturados: ...
Urgencia sugerida: ...
Próximo paso: ...

Conversación:
${conversationText}
`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Modelo más económico y rápido
      messages: [
        {
          role: 'system',
          content:
            'Eres un asistente experto en soporte operativo. Debes responder siempre con 4 líneas fijas y sin texto adicional.',
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

/**
 * Transcribe audio file from URL using Whisper.
 */
export async function transcribeAudio(audioUrl: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  if (!audioUrl?.startsWith("http://") && !audioUrl?.startsWith("https://")) {
    return null;
  }

  try {
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`No se pudo descargar audio (${response.status})`);
    }
    const contentType = response.headers.get("content-type") || "audio/ogg";
    const ext =
      contentType.includes("mpeg") ? "mp3" :
      contentType.includes("mp4") ? "m4a" :
      contentType.includes("wav") ? "wav" : "ogg";
    const blob = await response.blob();
    const file = new File([blob], `voice-note.${ext}`, { type: contentType });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: "es",
    });
    return transcription.text?.trim() || null;
  } catch (error: any) {
    console.error("[OpenAI] Error al transcribir audio:", error.message);
    return null;
  }
}
