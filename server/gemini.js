import { GoogleGenAI } from '@google/genai';
import { actions, systemInstruction, TeacherError, MAX_OUTPUT } from './ai-contract.js';

export const DEFAULT_FAST_MODEL = 'gemini-3.5-flash-lite';
export const DEFAULT_ADVANCED_MODEL = 'gemini-3.6-flash';
// Compatibility export for server integrations that previously imported it.
export const DEFAULT_MODEL = DEFAULT_FAST_MODEL;
export const FAST_ACTIONS = new Set([
  'sentence_hint',
  'sentence_check',
  'sentence_expand',
  'sentence_vivid',
  'vocabulary_help',
  'essay_next_step',
]);
export const ADVANCED_ACTIONS = new Set(['paragraph_review', 'essay_review']);
// Keep a margin below Vercel's 40-second function duration for response cleanup.
export const TIMEOUT_MS = 35000;
export const OUTPUT_TOKEN_CAPS = {
  sentence_hint: 320,
  sentence_check: 380,
  sentence_expand: 500,
  sentence_vivid: 500,
  vocabulary_help: 420,
  essay_next_step: 480,
  paragraph_review: 700,
  essay_review: 1100,
};

const configuredModel = (value, fallback) =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

// Browser input never controls this choice. The legacy model only preserves the
// routine route for existing deployments; it cannot replace the advanced route.
export function selectGeminiModel(action, env = {}) {
  const routeClass = ADVANCED_ACTIONS.has(action) ? 'advanced' : 'fast';
  if (routeClass === 'advanced')
    return {
      routeClass,
      model: configuredModel(env.GEMINI_ADVANCED_MODEL, DEFAULT_ADVANCED_MODEL),
    };
  return {
    routeClass,
    model: configuredModel(
      env.GEMINI_FAST_MODEL,
      configuredModel(env.GEMINI_MODEL, DEFAULT_FAST_MODEL),
    ),
  };
}

// The Interactions API uses the 2.5 models' defaults: Flash-Lite is off by
// default, while Flash retains its model-appropriate adaptive reasoning.
export function buildGenerationConfig({ action }) {
  return { max_output_tokens: OUTPUT_TOKEN_CAPS[action] };
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
      generation_config: buildGenerationConfig({ action: input.action }),
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
