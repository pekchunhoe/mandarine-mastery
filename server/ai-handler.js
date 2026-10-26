import { readFile } from 'node:fs/promises';
import { createVocabularyService } from '../js/vocabulary-service.js';
import { TUTOR_ACTION as A, localTutorResult } from '../js/tutor-actions.js';
import {
  MAX_BODY,
  MAX_OUTPUT,
  TeacherError,
  messages,
  validateInput,
  normalizeResult,
  validateTeachingResult,
  validateSentenceKeywordResult,
  validateSentenceScenarioResult,
  teachingSpec,
} from './ai-contract.js';
import { TIMEOUT_MS, generateTeachingResult, selectGeminiModel } from './gemini.js';
import { clientRateLimit, createTutorLimiter, DEFAULT_TOTAL_RPM } from './ai-rate-limit.js';
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

// Read bounded structured metadata only; never parse/log provider message text.
export function upstreamRetryAfter(error, time = Date.now()) {
  const headers = error?.headers || error?.rawResponse?.headers;
  const header = (name) => headers?.get?.(name) ?? headers?.[name] ?? headers?.[name === 'retry-after' ? 'Retry-After' : 'Retry-After-Ms'];
  const seconds = [];
  const add = (value) => { if (Number.isFinite(value) && value >= 0 && value <= 86400) seconds.push(Math.max(1, Math.ceil(value))); };
  const retry = header('retry-after');
  if (typeof retry === 'string' && retry.length <= 128) {
    if (/^\d+(?:\.\d+)?$/u.test(retry.trim())) add(Number(retry));
    else add((Date.parse(retry) - time) / 1000);
  }
  const milliseconds = header('retry-after-ms');
  if (typeof milliseconds === 'string' && /^\d{1,9}$/u.test(milliseconds)) add(Number(milliseconds) / 1000);
  for (const details of [error?.error?.details, error?.error?.error?.details, error?.data$?.error?.details])
    if (Array.isArray(details)) for (const detail of details.slice(0, 16)) {
      if (detail?.['@type'] === 'type.googleapis.com/google.rpc.RetryInfo' &&
          typeof detail.retryDelay === 'string' && /^\d{1,8}(?:\.\d{1,9})?s$/u.test(detail.retryDelay))
        add(Number(detail.retryDelay.slice(0, -1)));
    }
  return seconds.length ? Math.max(...seconds) : undefined;
}

export function createTeacherHandler({
  generate = generateTeachingResult,
  env = process.env,
  timeoutMs = TIMEOUT_MS,
  vocabulary = getVocabulary,
  limiter = createTutorLimiter({ perClient: clientRateLimit(env.AI_CLIENT_RPM), total: Math.min(DEFAULT_TOTAL_RPM, clientRateLimit(env.AI_CLIENT_RPM)) }),
  now = Date.now,
  logger = console,
} = {}) {
  let providerBackoff;
  const assertProviderReady = () => {
    const seconds = providerBackoff && Math.ceil((providerBackoff.until - now()) / 1000);
    if (seconds > 0) throw new TeacherError(providerBackoff.code, providerBackoff.status, { retryAfterSeconds: seconds });
  };
  return async (request) => {
    const arrivedAt = now();
    const timing = { prepareMs: 0, limiterMs: 0, queueMs: 0, geminiMs: 0, validationMs: 0, retryMs: 0 };
    let attempts = 0;
    const elapsed = (start) => Math.max(0, now() - start);
    const timedReply = (body, status = 200, headers = {}) => reply(body, status, {
      'Server-Timing': [...Object.entries(timing).map(([name, value]) => `${name};dur=${value.toFixed(3)}`), `totalMs;dur=${elapsed(arrivedAt).toFixed(3)}`, `attempts;desc="${attempts}"`].join(', '),
      ...headers,
    });
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
      if (data) return timedReply({ ok: true, action: input.action, data });
      const apiKey = env.GEMINI_API_KEY?.trim();
      if (!apiKey) throw new TeacherError('AI_NOT_CONFIGURED', 503);
      action = input.action;
      ({ model, routeClass } = selectGeminiModel(action, env, input.activity));
      assertProviderReady();
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
      timing.prepareMs = elapsed(arrivedAt);
      let cacheable = true;
      {
        startedAt = now();
        logger.info?.('AI teacher request started', {
          action,
          routeClass,
          model,
        });
        const cancellation = new Promise((_, reject) => {
          cancelRequest = () => {
            reject(new TeacherError('AI_CANCELLED', 499));
            controller.abort();
          };
          request.signal.addEventListener('abort', cancelRequest, { once: true });
          if (request.signal.aborted) cancelRequest();
        });
        // Both attempts share the existing deadline and cancellation. Every
        // upstream call also acquires the existing rate/concurrency limiter.
        const deadline = Promise.race([
          cancellation,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              reject(new TeacherError('AI_TIMEOUT', 504));
              controller.abort();
            }, timeoutMs);
          }),
        ]);
        const generateOnce = () => generate(input, {
            apiKey,
            model,
            signal: controller.signal,
            onDiagnostic: (diagnostic) => {
              interactionDiagnostic = diagnostic;
            },
          });
        for (let attempt = 0; attempt < 2; attempt++) {
          if (request.signal.aborted || controller.signal.aborted)
            throw new TeacherError('AI_CANCELLED', 499);
          if (attempt) {
            release?.();
            release = undefined;
            input.keywordRetry = true;
          }
          assertProviderReady();
          const retryStarted = now();
          const admissionStarted = now();
          try { release = limiter.acquire(request, env.VERCEL === '1'); }
          finally { timing.limiterMs += elapsed(admissionStarted); }
          const generationStarted = now();
          let raw;
          try {
            attempts++;
            interactionDiagnostic = undefined;
            raw = await Promise.race([deadline, generateOnce()]);
          } finally {
            timing.geminiMs += elapsed(generationStarted);
            if (attempt) timing.retryMs += elapsed(retryStarted);
          }
          if (typeof raw !== 'string' || raw.length > MAX_OUTPUT)
            throw new TeacherError('AI_INVALID_RESPONSE', 502);
          const validationStarted = now();
          try {
            const parsed = JSON.parse(raw);
            if (input.action === A.VOCABULARY_HELP) {
              // Check raw AI examples before vocabulary filtering can drop them.
              if (input.activity === 'sentenceBuilder' && input.context.topic) {
                const checked = normalizeResult({ supplementalVocabulary: [], ...parsed }, teachingSpec(input).schema);
                validateSentenceKeywordResult(input, checked);
                validateSentenceScenarioResult(input, checked);
              }
              const { examples, ...vocabularyOutput } = parsed;
              ({ data, cacheable } = resolveVocabularyResult(
                input.activity === 'sentenceBuilder' ? vocabularyOutput : parsed, records, store));
              if (input.activity === 'sentenceBuilder' && examples !== undefined) data.examples = examples;
            } else
              data = validateTeachingResult(
                input.action,
                normalizeResult(parsed, teachingSpec(input).schema),
                input.context,
              );
            validateSentenceKeywordResult(input, data);
            validateSentenceScenarioResult(input, data);
            break;
          } catch (error) {
            if (error instanceof TeacherError && ['AI_KEYWORD_MISSING', 'AI_SCENARIO_MISMATCH'].includes(error.code) && attempt === 0) continue;
            if (error instanceof TeacherError) throw error;
            throw new TeacherError('AI_INVALID_RESPONSE', 502);
          } finally {
            const duration = elapsed(validationStarted);
            timing.validationMs += duration;
            if (attempt) timing.retryMs += duration;
          }
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
      return timedReply({
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
        code = 'AI_PROVIDER_QUOTA';
        status = 429;
      }
      if (upstreamStatus === 404) { code = 'AI_MODEL_UNAVAILABLE'; status = 503; }
      const retryGuidance = [429, 503].includes(upstreamStatus) ? upstreamRetryAfter(error, now()) : undefined;
      if (upstreamStatus === 429 || upstreamStatus === 503) {
        const time = now();
        const existing = providerBackoff?.until > time ? providerBackoff : null;
        const quota = upstreamStatus === 429 || existing?.code === 'AI_PROVIDER_QUOTA';
        providerBackoff = {
          code: quota ? 'AI_PROVIDER_QUOTA' : 'AI_UNAVAILABLE', status: quota ? 429 : 503,
          until: Math.max(existing?.until || 0, time + (retryGuidance ?? (upstreamStatus === 429 ? 60 : 5)) * 1000),
        };
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
              AI_PROVIDER_QUOTA: 'rate_limited',
              AI_BUSY: 'busy',
              AI_MODEL_UNAVAILABLE: 'not_found',
              AI_REFUSAL: 'safety',
              AI_INVALID_RESPONSE: 'malformed_response',
              AI_KEYWORD_MISSING: 'malformed_response',
              AI_SCENARIO_MISMATCH: 'malformed_response',
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
        ['AI_RATE_LIMIT', 'AI_BUSY', 'AI_PROVIDER_QUOTA', 'AI_UNAVAILABLE'].includes(code) &&
        Number.isInteger(error?.retryAfterSeconds) &&
        error.retryAfterSeconds >= 1 &&
        error.retryAfterSeconds <= 86400
          ? error.retryAfterSeconds
          : providerBackoff && (providerBackoff.code === code || [429, 503].includes(upstreamStatus)) && providerBackoff.until > now()
            ? Math.ceil((providerBackoff.until - now()) / 1000) : undefined;
      return timedReply(
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
      if (action) logger.info?.('AI teacher performance', {
        action, model, arrivedAt, attempts, ...timing, totalMs: elapsed(arrivedAt),
      });
    }
  };
}
