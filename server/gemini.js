import { GoogleGenAI } from '@google/genai';
import { actions, systemInstruction, TeacherError, MAX_OUTPUT } from './ai-contract.js';

export const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
// Keep a margin below Vercel's 40-second function duration for response cleanup.
export const TIMEOUT_MS = 35000;
export const OUTPUT_TOKEN_CAPS = {
  sentence_hint: 650,
  sentence_check: 900,
  sentence_expand: 1000,
  sentence_vivid: 900,
  vocabulary_help: 900,
  essay_next_step: 900,
  paragraph_review: 1300,
  essay_review: 1600,
};

export function buildGenerationConfig({ model, action }) {
  const config = { max_output_tokens: OUTPUT_TOKEN_CAPS[action] };
  const normalizedModel = model.trim().toLowerCase();
  if (normalizedModel === 'gemini-2.5-flash-lite')
    return { ...config, thinking_config: { thinking_budget: 0 } };
  if (normalizedModel === 'gemini-3.8-flash') return { ...config, thinking_level: 'low' };
  return config;
}

export function thinkingModeForModel(model) {
  const normalizedModel = model.trim().toLowerCase();
  if (normalizedModel === 'gemini-2.5-flash-lite') return 'off';
  if (normalizedModel === 'gemini-3.8-flash') return 'low';
  return 'default';
}

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
      generation_config: buildGenerationConfig({ model, action: input.action }),
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
