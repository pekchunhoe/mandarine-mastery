import { readFile } from 'node:fs/promises';
import { createVocabularyService } from '../js/vocabulary-service.js';
import { TUTOR_ACTION as A, localTutorResult } from '../js/tutor-actions.js';
import {
  actions,
  MAX_BODY,
  MAX_OUTPUT,
  TeacherError,
  messages,
  validateInput,
  normalizeResult,
  validateTeachingResult,
} from './ai-contract.js';
import {
  DEFAULT_MODEL,
  TIMEOUT_MS,
  generateTeachingResult,
  thinkingModeForModel,
} from './gemini.js';
import { clientRateLimit, createTutorLimiter } from './ai-rate-limit.js';

let library;
async function getVocabulary() {
  library ||= readFile(new URL('../data/vocabulary.json', import.meta.url), 'utf8')
    .then((text) => createVocabularyService(JSON.parse(text)))
    .catch((error) => {
      library = null;
      throw error;
    });
  return library;
}
const reply = (body, status = 200, headers = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
async function readBody(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY)
    throw new TeacherError('TEXT_TOO_LONG', 413);
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  )
    throw new TeacherError('INVALID_REQUEST', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new TeacherError('INVALID_REQUEST');
  const chunks = [];
  let size = 0;
  const timer = setTimeout(() => reader.cancel().catch(() => {}), 5000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        throw new TeacherError('TEXT_TOO_LONG', 413);
      }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof TeacherError) throw error;
    throw new TeacherError('INVALID_REQUEST');
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
// Only trusted library fields cross back to the browser, never AI-supplied definitions.
const trustedWord = ({
  id,
  word,
  pinyin,
  definitionChinese,
  generatedSynonyms,
  synonyms,
  exampleSentence,
}) => ({ id, word, pinyin, definitionChinese, generatedSynonyms, synonyms, exampleSentence });

export function createTeacherHandler({
  generate = generateTeachingResult,
  env = process.env,
  timeoutMs = TIMEOUT_MS,
  vocabulary = getVocabulary,
  limiter = createTutorLimiter({ perClient: clientRateLimit(env.AI_CLIENT_RPM) }),
  now = Date.now,
  logger = console,
} = {}) {
  return async (request) => {
    if (request.method !== 'POST')
      return reply(
        { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: messages.METHOD_NOT_ALLOWED } },
        405,
        { Allow: 'POST' },
      );
    let timer, release, cancelRequest, action, model, startedAt;
    const controller = new AbortController();
    try {
      const origin = request.headers.get('origin');
      if (origin && origin !== new URL(request.url).origin)
        throw new TeacherError('INVALID_REQUEST', 403);
      const input = validateInput(await readBody(request));
      if (request.signal.aborted) throw new TeacherError('AI_CANCELLED', 499);
      let data = localTutorResult(input.action, input.context);
      if (data) return reply({ ok: true, action: input.action, data });
      const apiKey = env.GEMINI_API_KEY?.trim();
      if (!apiKey) throw new TeacherError('AI_NOT_CONFIGURED', 503);
      model = env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
      action = input.action;
      const candidates =
        input.action === A.VOCABULARY_HELP ? input.context.availableVocabularyIds || [] : [];
      const store = candidates.length ? await vocabulary() : null;
      const records = candidates.map((id) => store.getWordById(id)).filter(Boolean);
      input.vocabularyCandidates = records.map(({ id, word, definitionChinese }) => ({
        id,
        word,
        definitionChinese,
      }));
      delete input.context.availableVocabularyIds;
      if (input.action === A.VOCABULARY_HELP && !records.length) {
        data = {
          recommendations: [],
          studentTask: '打开词语库，找一个合适的词，自己试着写一句话。',
        };
      } else {
        startedAt = now();
        logger.info?.('AI teacher request started', {
          action,
          model,
          thinkingMode: thinkingModeForModel(model),
        });
        release = limiter.acquire(request, env.VERCEL === '1');
        const cancellation = new Promise((_, reject) => {
          cancelRequest = () => {
            reject(new TeacherError('AI_CANCELLED', 499));
            controller.abort();
          };
          request.signal.addEventListener('abort', cancelRequest, { once: true });
          if (request.signal.aborted) cancelRequest();
        });
        const raw = await Promise.race([
          cancellation,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              reject(new TeacherError('AI_TIMEOUT', 504));
              controller.abort();
            }, timeoutMs);
          }),
          generate(input, { apiKey, model, signal: controller.signal }),
        ]);
        if (typeof raw !== 'string' || raw.length > MAX_OUTPUT)
          throw new TeacherError('AI_INVALID_RESPONSE', 502);
        try {
          data = validateTeachingResult(
            input.action,
            normalizeResult(JSON.parse(raw), actions[input.action].schema),
            input.context,
          );
        } catch (error) {
          if (error instanceof TeacherError) throw error;
          throw new TeacherError('AI_INVALID_RESPONSE', 502);
        }
      }
      if (input.action === A.VOCABULARY_HELP) {
        const allowed = new Map(records.map((word) => [word.id, word]));
        const seen = new Set();
        data.recommendations = data.recommendations
          .filter((item) => {
            if (!allowed.has(item.vocabularyId) || seen.has(item.vocabularyId)) return false;
            seen.add(item.vocabularyId);
            return true;
          })
          .map((item) => ({ ...item, vocabulary: trustedWord(allowed.get(item.vocabularyId)) }));
      }
      if (JSON.stringify(data).includes(apiKey)) throw new TeacherError('AI_INVALID_RESPONSE', 502);
      if (startedAt !== undefined)
        logger.info?.('AI teacher request completed', {
          action,
          model,
          thinkingMode: thinkingModeForModel(model),
          durationMs: Math.max(0, now() - startedAt),
          status: 'success',
        });
      return reply({ ok: true, action: input.action, data });
    } catch (error) {
      let code = error instanceof TeacherError ? error.code : 'AI_UNAVAILABLE';
      let status = error instanceof TeacherError ? error.status : 503;
      if (Number(error?.status ?? error?.statusCode) === 429) {
        code = 'AI_RATE_LIMIT';
        status = 429;
      }
      if (
        ['AbortError', 'TimeoutError', 'RequestTimeoutError', 'APIConnectionTimeoutError'].includes(
          error?.name,
        )
      ) {
        code = 'AI_TIMEOUT';
        status = 504;
      }
      if (startedAt !== undefined) {
        const logStatus =
          {
            AI_TIMEOUT: 'timeout',
            AI_UNAVAILABLE: 'unavailable',
            AI_RATE_LIMIT: 'rate_limited',
            AI_REFUSAL: 'safety',
            AI_INVALID_RESPONSE: 'malformed_response',
            AI_CANCELLED: 'cancelled',
          }[code] || 'unavailable';
        logger.warn?.('AI teacher request failed', {
          action,
          model,
          thinkingMode: thinkingModeForModel(model),
          durationMs: Math.max(0, now() - startedAt),
          status: logStatus,
        });
      }
      const retryAfterSeconds =
        code === 'AI_RATE_LIMIT' &&
        Number.isInteger(error?.retryAfterSeconds) &&
        error.retryAfterSeconds >= 1 &&
        error.retryAfterSeconds <= 60
          ? error.retryAfterSeconds
          : undefined;
      return reply(
        {
          ok: false,
          error: {
            code,
            message: messages[code] || messages.AI_UNAVAILABLE,
            ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
          },
        },
        status,
        retryAfterSeconds ? { 'Retry-After': String(retryAfterSeconds) } : {},
      );
    } finally {
      clearTimeout(timer);
      controller.abort();
      release?.();
      if (cancelRequest) request.signal.removeEventListener('abort', cancelRequest);
    }
  };
}
