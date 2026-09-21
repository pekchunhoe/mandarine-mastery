import { GoogleGenAI } from '@google/genai';
import { actions, systemInstruction, TeacherError, MAX_OUTPUT } from './ai-contract.js';

export const DEFAULT_MODEL = 'gemini-3.8-flash';
// Keep a margin below Vercel's 40-second function duration for response cleanup.
export const TIMEOUT_MS = 35000;
export const THINKING_LEVEL = 'low';

// Isolated SDK adapter. No browser imports, conversation storage, tools or secrets in prompts.
export async function generateTeachingResult(input, { apiKey, model, signal }) {
  const ai = new GoogleGenAI({ apiKey });
  const result = await ai.interactions.create(
    {
      model,
      system_instruction: `${systemInstruction}\n${actions[input.action].instruction}`,
      input: JSON.stringify({
        activity: input.activity,
        context: input.context,
        vocabularyCandidates: input.vocabularyCandidates,
      }),
      store: false,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: actions[input.action].schema,
      },
      generation_config: { max_output_tokens: 2500, thinking_level: THINKING_LEVEL },
    },
    { signal, timeout: TIMEOUT_MS, maxRetries: 0 },
  );
  if (result.status === 'failed' || result.status === 'cancelled')
    throw new TeacherError('AI_REFUSAL', 422);
  const text = result.output_text;
  if (!text) throw new TeacherError('AI_REFUSAL', 422);
  if (text.length > MAX_OUTPUT || result.status === 'incomplete')
    throw new TeacherError('AI_INVALID_RESPONSE', 502);
  return text;
}
