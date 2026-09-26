// Same-origin, reusable AI service. It never imports a server module or an API key.
import {
  TUTOR_ACTION as A,
  tutorActions,
  tutorRequest,
  localTutorResult,
  TutorInputError,
  MAX_BODY,
} from './tutor-actions.js';
export class AIError extends Error {
  constructor(message, { retryAfterSeconds } = {}) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
// Leave five seconds for the server's controlled response after its 35-second upstream cutoff.
export const BROWSER_TIMEOUT_MS = 40000;
export const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_NAMESPACE = 'tutor-response-v3';
const teachingCache = new Map();
const unavailable = '暂时无法联系 AI老师，请稍后再试。';
const errors = {
  AI_NOT_CONFIGURED: 'AI老师暂时还不能使用，请联系老师。其他练习仍可正常使用。',
  AI_RATE_LIMIT: 'AI老师今天有点忙，请稍后再试。',
  AI_TIMEOUT: 'AI老师阅读的时间有点长，请稍后再试。',
  AI_REFUSAL: 'AI老师这次无法分析这段内容，你可以修改后再试。',
  AI_INVALID_RESPONSE: 'AI老师这次的回复不完整，请再试一次。',
  TEXT_REQUIRED: '请先写一些内容，AI老师才能给你建议。',
  TEXT_TOO_LONG: '内容太长了，请选择较短的一段再试（最多 6000 字符）。',
};
const clone = (value) => structuredClone(value);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
// Validate the new response shapes before caching or rendering a successful envelope.
const validTeachingData = (action, data) => {
  if (!nonempty(data.studentTask)) return false;
  const strings = (values) => Array.isArray(values) && values.every(nonempty);
  const items = (values, keys) =>
    Array.isArray(values) &&
    values.every((item) => item && keys.every((key) => nonempty(item[key])));
  if (action === A.SENTENCE_HINT)
    return (
      strings(data.thinkingQuestions) &&
      data.thinkingQuestions.length > 0 &&
      strings(data.usefulPatterns)
    );
  if (action === A.SENTENCE_CHECK)
    return (
      ['correct', 'needs_revision'].includes(data.status) &&
      nonempty(data.original) &&
      items(data.issues, ['category', 'severity', 'text', 'explanation']) &&
      items(data.styleSuggestions, ['text', 'explanation']) &&
      typeof data.suggestedRevision === 'string'
    );
  if (action === A.SENTENCE_EXPAND)
    return (
      nonempty(data.original) &&
      items(data.levels, ['focus', 'example']) &&
      data.levels.length >= 2 &&
      data.levels.every((item, index) => item.level === index + 1)
    );
  if (action === A.SENTENCE_VIVID)
    return (
      nonempty(data.original) &&
      items(data.techniques, ['type', 'suggestion']) &&
      nonempty(data.example) &&
      nonempty(data.tryYourself)
    );
  if (action === A.ESSAY_NEXT_STEP)
    return nonempty(data.currentProgress) && items(data.directions, ['title', 'prompt']);
  if (action === A.PARAGRAPH_REVIEW)
    return (
      strings(data.strengths) &&
      strings(data.missingDetails) &&
      nonempty(data.revisionFocus) &&
      items(data.issues, ['type', 'text']) &&
      data.issues.every((item) => strings(item.suggestions))
    );
  if (action === A.ESSAY_REVIEW)
    return (
      nonempty(data.summary) &&
      strings(data.priorityImprovements) &&
      data.categories &&
      ['topicRelevance', 'structure', 'description', 'vocabulary', 'language'].every(
        (key) =>
          ['good', 'improve'].includes(data.categories[key]?.status) &&
          nonempty(data.categories[key]?.feedback),
      )
    );
  if ([A.PARAGRAPH_EXPAND, A.PARAGRAPH_VIVID].includes(action))
    return (
      nonempty(data.studentTask) &&
      nonempty(data.example) &&
      nonempty(data.explanation) &&
      Array.isArray(data.suggestions) &&
      data.suggestions.length >= 1 &&
      data.suggestions.length <= 3 &&
      data.suggestions.every((item) => item && nonempty(item.focus) && nonempty(item.suggestion))
    );
  if (action === A.VOCABULARY_HELP)
    return (
      nonempty(data.studentTask) &&
      Array.isArray(data.recommendations) &&
      data.recommendations.length <= 8 &&
      data.recommendations.every((item) => {
        const word = item?.vocabulary;
        return (
          word &&
          nonempty(word.word) &&
          nonempty(item.reason) &&
          nonempty(item.exampleUsage) &&
          (item.source === 'ai'
            ? [word.pinyin, word.definitionChinese, word.exampleSentence].every(nonempty)
            : (!item.source || item.source === 'library') &&
              nonempty(item.vocabularyId) &&
              word.id === item.vocabularyId)
        );
      })
    );
  return true;
};
const cacheKey = (action, request) =>
  JSON.stringify({
    namespace: CACHE_NAMESPACE,
    action,
    activity: request.activity,
    context: request.context,
  });
const cachedResult = (key) => {
  const entry = teachingCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    teachingCache.delete(key);
    return null;
  }
  return clone(entry.data);
};
export function clearTeachingCache() {
  teachingCache.clear();
}
export async function requestTeaching(action, payload, { signal } = {}) {
  signal?.throwIfAborted();
  let request;
  try {
    request = tutorRequest(action, payload.activity, payload.context);
  } catch (error) {
    if (error instanceof TutorInputError) throw new AIError(error.message);
    throw error;
  }
  const local = localTutorResult(action, request.context);
  if (local) return local;
  if (globalThis.navigator?.onLine === false) throw new AIError('网络连接失败，请检查网络后再试。');
  const body = JSON.stringify(request);
  if (new TextEncoder().encode(body).length > MAX_BODY) throw new AIError(errors.TEXT_TOO_LONG);
  const key = cacheKey(action, request);
  const cached = cachedResult(key);
  if (cached) return cached;
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => {
    timedOut = true;
    abort();
  }, BROWSER_TIMEOUT_MS);
  try {
    const response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
    });
    const result = await response.json();
    const retryAfterSeconds =
      result.error?.code === 'AI_RATE_LIMIT' &&
      Number.isInteger(result.error.retryAfterSeconds) &&
      result.error.retryAfterSeconds >= 1 &&
      result.error.retryAfterSeconds <= 60
        ? result.error.retryAfterSeconds
        : undefined;
    if (!response.ok || !result.ok) {
      const message = retryAfterSeconds
        ? `AI老师需要休息约 ${retryAfterSeconds} 秒，请继续写作，稍后再试。`
        : errors[result.error?.code] || unavailable;
      throw new AIError(message, { retryAfterSeconds });
    }
    if (result.action !== action || !result.data || typeof result.data !== 'object')
      throw new AIError(errors.AI_INVALID_RESPONSE);
    if (!validTeachingData(action, result.data)) throw new AIError(errors.AI_INVALID_RESPONSE);
    signal?.throwIfAborted();
    if (controller.signal.aborted) throw new AIError(errors.AI_TIMEOUT);
    if (result.cacheable !== false)
      teachingCache.set(key, { data: clone(result.data), expiresAt: Date.now() + CACHE_TTL_MS });
    return result.data;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timedOut) throw new AIError(errors.AI_TIMEOUT);
    if (error instanceof AIError) throw error;
    throw new AIError(unavailable);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
export const aiTeacher = Object.fromEntries(
  Object.keys(tutorActions).map((action) => [
    action,
    (payload, options) => requestTeaching(action, payload, options),
  ]),
);

export function paragraphTarget(editor, fallback = '') {
  if (!editor) return { text: fallback, label: '检查范围：当前写作段落' };
  const { value, selectionStart: start, selectionEnd: end } = editor;
  if (Number.isInteger(start) && end > start)
    return { text: value.slice(start, end), label: '检查范围：选中的文字' };
  if (Number.isInteger(start)) {
    const from = value.lastIndexOf('\n', start - 1) + 1;
    const next = value.indexOf('\n', start);
    return {
      text: value.slice(from, next < 0 ? value.length : next),
      label: '检查范围：光标所在段落',
    };
  }
  return { text: value, label: '检查范围：当前编辑段落' };
}
