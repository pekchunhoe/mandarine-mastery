// Same-origin, reusable AI service. It never imports a server module or an API key.
import {
  tutorActions,
  tutorRequest,
  localTutorResult,
  TutorInputError,
  MAX_BODY,
} from './tutor-actions.js';
export class AIError extends Error {}
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
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => {
    timedOut = true;
    abort();
  }, 30000);
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
    if (!response.ok || !result.ok) throw new AIError(errors[result.error?.code] || unavailable);
    if (result.action !== action || !result.data || typeof result.data !== 'object')
      throw new AIError(errors.AI_INVALID_RESPONSE);
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
