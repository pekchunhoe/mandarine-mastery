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
import { TIMEOUT_MS, generateTeachingResult, selectGeminiModel } from './gemini.js';
import { clientRateLimit, createTutorLimiter } from './ai-rate-limit.js';
import { resolveVocabularyResult } from './ai-vocabulary.js';

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
const safeUpstreamCode = (value) =>
  typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(value) ? value : undefined;

// The SDK exposes these fields on its typed error objects. Read only bounded,
// structured metadata and never parse or log an upstream body or message.
export function upstreamDiagnostic(error) {
  if (!error || typeof error !== 'object') return {};
  const upstreamStatus = [error.statusCode, error.status].find(
    (value) => Number.isInteger(value) && value >= 400 && value <= 599,
  );
  const upstreamCode = [
    error.error?.status,
    error.data$?.error?.status,
    error.error?.error?.status,
    error.code,
  ]
    .map(safeUpstreamCode)
    .find(Boolean);
  return { upstreamStatus, upstreamCode };
}

export const upstreamStatusCategory = (status) => {
  if (status === 400) return 'invalid_request';
  if (status === 401) return 'authentication';
  if (status === 403) return 'permission_denied';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return undefined;
};

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
    let timer, release, cancelRequest, action, model, routeClass, startedAt, interactionDiagnostic;
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
      action = input.action;
      ({ model, routeClass } = selectGeminiModel(action, env));
      const candidates =
        input.action === A.VOCABULARY_HELP ? input.context.availableVocabularyIds || [] : [];
      const store = input.action === A.VOCABULARY_HELP ? await vocabulary() : null;
      const records = candidates.map((id) => store.getWordById(id)).filter(Boolean);
      input.vocabularyCandidates = records.map(({ id, word, definitionChinese }) => ({
        id,
        word,
        definitionChinese,
      }));
      delete input.context.availableVocabularyIds;
      let cacheable = true;
      {
        startedAt = now();
        logger.info?.('AI teacher request started', {
          action,
          routeClass,
          model,
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
          generate(input, {
            apiKey,
            model,
            signal: controller.signal,
            onDiagnostic: (diagnostic) => {
              interactionDiagnostic = diagnostic;
            },
          }),
        ]);
        if (typeof raw !== 'string' || raw.length > MAX_OUTPUT)
          throw new TeacherError('AI_INVALID_RESPONSE', 502);
        try {
          if (input.action === A.VOCABULARY_HELP) {
            ({ data, cacheable } = resolveVocabularyResult(JSON.parse(raw), records, store));
          } else
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
      if (JSON.stringify(data).includes(apiKey)) throw new TeacherError('AI_INVALID_RESPONSE', 502);
      if (startedAt !== undefined)
        logger.info?.('AI teacher request completed', {
          action,
          routeClass,
          model,
          durationMs: Math.max(0, now() - startedAt),
          status: 'success',
          ...interactionDiagnostic,
        });
      return reply({
        ok: true,
        action: input.action,
        data,
        ...(cacheable ? {} : { cacheable: false }),
      });
    } catch (error) {
      let code = error instanceof TeacherError ? error.code : 'AI_UNAVAILABLE';
      let status = error instanceof TeacherError ? error.status : 503;
      const { upstreamStatus, upstreamCode } =
        error instanceof TeacherError ? {} : upstreamDiagnostic(error);
      if (upstreamStatus === 429) {
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
        const logStatus = ['incomplete', 'budget_exceeded'].includes(
          interactionDiagnostic?.interactionStatus,
        )
          ? 'incomplete_response'
          : upstreamStatusCategory(upstreamStatus) ||
            {
              AI_TIMEOUT: 'timeout',
              AI_UNAVAILABLE: 'unavailable',
              AI_RATE_LIMIT: 'rate_limited',
              AI_REFUSAL: 'safety',
              AI_INVALID_RESPONSE: 'malformed_response',
              AI_CANCELLED: 'cancelled',
            }[code] ||
            'unavailable';
        logger.warn?.('AI teacher request failed', {
          action,
          routeClass,
          model,
          durationMs: Math.max(0, now() - startedAt),
          status: logStatus,
          ...(upstreamStatus ? { upstreamStatus } : {}),
          ...(upstreamCode ? { upstreamCode } : {}),
          ...interactionDiagnostic,
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
