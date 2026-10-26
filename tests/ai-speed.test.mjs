import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTutorLimiter, DEFAULT_CLIENT_RPM, DEFAULT_TOTAL_RPM } from '../server/ai-rate-limit.js';
import { createTeacherHandler, upstreamRetryAfter } from '../server/ai-handler.js';
import { generateTeachingResult, selectGeminiModel, buildGenerationConfig, DEFAULT_FAST_MODEL, DEFAULT_ADVANCED_MODEL } from '../server/gemini.js';
import { TUTOR_ACTION as A, TUTOR_ACTIVITY as B, activityTutorActions } from '../js/tutor-actions.js';
import { requestTeaching, clearTeachingCache } from '../js/ai-teacher.js';
import { inputFor, resultFor, word } from './tutor-fixtures.mjs';
import { runningResult, scenarioRequest } from './sentence-scenario-fixtures.mjs';

const env = { GEMINI_API_KEY: 'test-speed-private-key' };
const req = (input = inputFor(A.SENTENCE_CHECK), address) => new Request('http://localhost/api/gemini', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(address ? { 'x-vercel-forwarded-for': address } : {}) }, body: JSON.stringify(input),
});
const handler = (options = {}) => createTeacherHandler({ env, logger: { info() {}, warn() {} },
  vocabulary: async () => ({ getWordById: () => word }),
  generate: async (input) => JSON.stringify(resultFor(input.action, input.context)), ...options,
});

test('absent, explicit 12, invalid and excessive environment settings share at most twelve attempts across activities and identities', async () => {
  assert.equal(DEFAULT_CLIENT_RPM, 12); assert.equal(DEFAULT_TOTAL_RPM, 12);
  for (const configured of [undefined, '12', '0', '-1', '1.5', 'invalid', '13', '20', '40', '100']) {
    let calls = 0;
    const endpoint = handler({ env: { ...env, VERCEL: '1', ...(configured === undefined ? {} : { AI_CLIENT_RPM: configured }) },
      generate: async (input) => { calls++; return JSON.stringify(resultFor(input.action, input.context)); } });
    for (let index = 0; index < 12; index++)
      assert.equal((await endpoint(req(inputFor(index % 2 ? A.SENTENCE_CHECK : A.PARAGRAPH_REVIEW), index % 2 ? 'student-a' : 'student-b'))).status, 200, `setting ${configured}`);
    const denied = await endpoint(req(inputFor(A.SENTENCE_CHECK), 'student-c'));
    assert.equal(denied.status, 429); assert.equal((await denied.json()).error.code, 'AI_RATE_LIMIT');
    assert.equal(calls, 12);
  }
});

test('rolling boundaries prevent a fixed-window burst; only expired attempts replenish capacity', () => {
  let clock = 0;
  const limiter = createTutorLimiter({ now: () => clock });
  for (let index = 0; index < 6; index++) limiter.acquire(req())();
  clock = 30000;
  for (let index = 0; index < 6; index++) limiter.acquire(req())();
  clock = 59999;
  assert.throws(() => limiter.acquire(req()), (error) => error.retryAfterSeconds === 1);
  clock = 60000;
  for (let index = 0; index < 6; index++) limiter.acquire(req())();
  assert.throws(() => limiter.acquire(req()), (error) => error.retryAfterSeconds === 30);
  clock = 90000;
  for (let index = 0; index < 6; index++) limiter.acquire(req())();
  assert.throws(() => limiter.acquire(req()), /AI_RATE_LIMIT/);
});

test('four operations run concurrently without a queue; a fifth fails briefly and does not spend an attempt', async () => {
  const releases = [];
  let entered = 0;
  let ready;
  const started = new Promise((resolve) => { ready = resolve; });
  const endpoint = handler({ generate: async (input) => {
    entered++; if (entered === 4) ready();
    if (entered <= 4) await new Promise((resolve) => releases.push(resolve));
    return JSON.stringify(resultFor(input.action, input.context));
  } });
  const pending = Array.from({ length: 4 }, (_, index) => endpoint(req(inputFor(index % 2 ? A.SENTENCE_CHECK : A.PARAGRAPH_REVIEW))));
  await started;
  const busy = await endpoint(req());
  assert.equal(busy.status, 429); assert.equal((await busy.json()).error.code, 'AI_BUSY');
  assert.equal(busy.headers.get('retry-after'), '1'); assert.equal(entered, 4);
  releases.forEach((release) => release());
  for (const response of await Promise.all(pending)) assert.equal(response.status, 200);
  for (let batch = 0; batch < 2; batch++) {
    const responses = await Promise.all(Array.from({ length: 4 }, (_, index) => endpoint(req(inputFor(index % 2 ? A.SENTENCE_CHECK : A.PARAGRAPH_REVIEW)))));
    for (const response of responses) assert.equal(response.status, 200);
  }
  assert.equal(entered, 12);
  const exhausted = await endpoint(req());
  assert.equal(exhausted.status, 429); assert.equal((await exhausted.json()).error.code, 'AI_RATE_LIMIT');
  assert.equal(entered, 12);
});

test('validation retries consume the same capacity and cannot exceed twelve upstream calls', async () => {
  let calls = 0;
  const endpoint = handler({ generate: async (input) => {
    calls++;
    if (input.action !== A.SENTENCE_VIVID) return JSON.stringify(resultFor(input.action, input.context));
    const data = runningResult(input.action, input.context); data.example = '我每天努力学习。'; return JSON.stringify(data);
  } });
  for (let index = 0; index < 11; index++) assert.equal((await endpoint(req())).status, 200);
  const response = await endpoint(req(scenarioRequest(A.SENTENCE_VIVID)));
  assert.equal(response.status, 429); assert.equal(calls, 12);
  assert.ok(response.headers.get('Server-Timing').includes('attempts;desc="1"'));
});

test('an admitted validation retry spends the twelfth slot before a different activity can run', async () => {
  let calls = 0;
  const endpoint = handler({ generate: async (input) => {
    calls++;
    if (input.action !== A.SENTENCE_VIVID) return JSON.stringify(resultFor(input.action, input.context));
    const data = runningResult(input.action, input.context);
    if (calls === 11) data.example = '我每天努力学习。';
    return JSON.stringify(data);
  } });
  for (let index = 0; index < 10; index++) assert.equal((await endpoint(req())).status, 200);
  const response = await endpoint(req(scenarioRequest(A.SENTENCE_VIVID)));
  assert.equal(response.status, 200); assert.equal(calls, 12);
  assert.ok(response.headers.get('Server-Timing').includes('attempts;desc="2"'));
  const denied = await endpoint(req(inputFor(A.PARAGRAPH_REVIEW)));
  assert.equal(denied.status, 429); assert.equal(calls, 12);
});

test('explicit lower allowance also caps the shared instance budget; independent instances remain explicitly local', async () => {
  const endpoint = handler({ env: { ...env, AI_CLIENT_RPM: '2', VERCEL: '1' } });
  assert.equal((await endpoint(req(undefined, 'one'))).status, 200);
  assert.equal((await endpoint(req(undefined, 'two'))).status, 200);
  assert.equal((await endpoint(req(undefined, 'three'))).status, 429);
  const a = createTutorLimiter(), b = createTutorLimiter();
  for (let index = 0; index < 12; index++) a.acquire(req())();
  assert.throws(() => a.acquire(req()), /AI_RATE_LIMIT/);
  assert.doesNotThrow(() => b.acquire(req())()); // No false distributed-limit claim.
});

test('all twelve activity/action pairs actually send Flash-Lite and minimal thinking to the installed SDK despite overrides', async (t) => {
  let action, sent = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const request = url instanceof Request ? url : new Request(url, options);
    const body = await request.json(); sent.push(body);
    return Response.json({ id: 'mock', status: 'completed', output_text: JSON.stringify(resultFor(action, JSON.parse(body.input).context)), steps: [] });
  });
  const endpoint = handler({ env: { ...env, AI_CLIENT_RPM: '12', GEMINI_FAST_MODEL: 'not-allowed', GEMINI_ADVANCED_MODEL: 'not-allowed', GEMINI_MODEL: 'not-allowed' }, generate: generateTeachingResult });
  for (const activity of [B.SENTENCE, B.ESSAY]) for (action of activityTutorActions[activity]) {
    const input = inputFor(action);
    if (activity === B.ESSAY && action === A.VOCABULARY_HELP) Object.assign(input, { activity, context: { selectedTitle: '运动会', studentParagraph: '我和同学一起参加接力赛。', availableVocabularyIds: [word.id] } });
    const response = await endpoint(req({ ...input, model: 'not-allowed', context: { ...input.context, model: 'not-allowed' } }));
    assert.equal(response.status, 200, `${activity}:${action}`);
    assert.equal(sent.at(-1).model, 'gemini-3.5-flash-lite');
    assert.equal(sent.at(-1).generation_config.thinking_level, 'minimal');
    assert.ok(!JSON.stringify(sent.at(-1)).includes('not-allowed'));
  }
  assert.equal(sent.length, 12);
  assert.equal((await endpoint(req())).status, 429);
  assert.equal(sent.length, 12); // All buttons consumed the same handler allowance.
  assert.equal(selectGeminiModel(A.PARAGRAPH_REVIEW, {}, 'unrelatedActivity').model, DEFAULT_ADVANCED_MODEL);
  assert.equal(selectGeminiModel(A.SENTENCE_HINT, { GEMINI_MODEL: 'legacy-model' }, 'unrelatedActivity').model, 'legacy-model');
  assert.ok(!Object.hasOwn(buildGenerationConfig({ action: A.SENTENCE_HINT, activity: 'unrelatedActivity' }), 'thinking_level'));
});

test('unsupported model returns a safe error with one SDK attempt and no fallback', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ error: { status: 'NOT_FOUND', message: env.GEMINI_API_KEY } }, { status: 404 }); });
  const response = await handler({ generate: generateTeachingResult })(req());
  const result = await response.json();
  assert.equal(response.status, 503); assert.equal(result.error.code, 'AI_MODEL_UNAVAILABLE'); assert.equal(calls, 1);
  assert.ok(!JSON.stringify(result).includes(env.GEMINI_API_KEY));
});

test('Retry-After seconds, HTTP dates, milliseconds and structured RetryInfo are parsed without raw messages', () => {
  const clock = Date.UTC(2026, 9, 26);
  assert.equal(upstreamRetryAfter({ headers: new Headers({ 'Retry-After': '120' }) }, clock), 120);
  assert.equal(upstreamRetryAfter({ headers: new Headers({ 'Retry-After': new Date(clock + 90000).toUTCString() }) }, clock), 90);
  assert.equal(upstreamRetryAfter({ headers: new Headers({ 'retry-after-ms': '1250' }) }, clock), 2);
  assert.equal(upstreamRetryAfter({ error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3.5s' }] } }, clock), 4);
  assert.equal(upstreamRetryAfter({ headers: new Headers({ 'Retry-After': 'garbage' }), message: 'retry after 99 seconds private' }, clock), undefined);
});

test('provider 429/503 share a respected backoff across activities, with no hidden automatic requests or capacity consumption', async () => {
  for (const status of [429, 503]) {
    let clock = 0, calls = 0;
    const endpoint = handler({ now: () => clock, generate: async (input) => {
      calls++;
      if (calls === 1) throw { status, headers: new Headers({ 'Retry-After': '120' }), message: env.GEMINI_API_KEY };
      return JSON.stringify(resultFor(input.action, input.context));
    } });
    const response = await endpoint(req());
    assert.equal(response.status, status);
    assert.equal(response.headers.get('retry-after'), '120');
    assert.equal((await response.json()).error.code, status === 429 ? 'AI_PROVIDER_QUOTA' : 'AI_UNAVAILABLE');
    clock = 60000;
    const blocked = await endpoint(req(inputFor(A.PARAGRAPH_REVIEW)));
    assert.equal(blocked.status, status); assert.equal(blocked.headers.get('retry-after'), '60'); assert.equal(calls, 1);
    clock = 120000;
    assert.equal((await endpoint(req())).status, 200); assert.equal(calls, 2);
  }
});

test('server stage timings count real attempts and exclude writing, key, instructions and identifiers', async () => {
  let clock = 0, calls = 0;
  const logs = [];
  const input = scenarioRequest(A.SENTENCE_VIVID);
  const response = await handler({ now: () => ++clock, logger: { info: (...args) => logs.push(args), warn() {} }, generate: async () => {
    const data = runningResult(input.action); if (++calls === 1) data.example = '我每天努力写字。'; return JSON.stringify(data);
  } })(req(input));
  assert.equal(response.status, 200);
  const metrics = logs.find(([name]) => name === 'AI teacher performance')[1];
  assert.equal(metrics.attempts, 2); assert.equal(metrics.queueMs, 0); assert.ok(metrics.retryMs > 0);
  for (const key of ['prepareMs', 'limiterMs', 'geminiMs', 'validationMs', 'totalMs', 'arrivedAt']) assert.equal(typeof metrics[key], 'number');
  assert.ok(response.headers.get('Server-Timing').includes('attempts;desc="2"'));
  const text = JSON.stringify(logs);
  for (const privateText of [env.GEMINI_API_KEY, input.context.situation, input.context.studentSentence]) assert.ok(!text.includes(privateText));
});

test('a shorter concurrent provider failure cannot erase a longer quota backoff', async () => {
  let clock = 0, calls = 0, ready;
  const waiting = [], started = new Promise((resolve) => { ready = resolve; });
  const endpoint = handler({ now: () => clock, generate: async () => {
    calls++; if (calls === 2) ready();
    return new Promise((_, reject) => waiting.push(reject));
  } });
  const first = endpoint(req()), second = endpoint(req(inputFor(A.PARAGRAPH_REVIEW)));
  await started;
  waiting[0]({ status: 429, headers: new Headers({ 'Retry-After': '120' }) }); await first;
  waiting[1]({ status: 503, headers: new Headers({ 'Retry-After': '1' }) });
  const unavailable = await second;
  assert.equal(unavailable.headers.get('retry-after'), '120');
  clock = 1000;
  const response = await endpoint(req());
  assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '119'); assert.equal(calls, 2);
});

test('client distinguishes provider quota/backoff, does not retry/caches errors, and records bounded content-free timing', async (t) => {
  clearTeachingCache(); t.after(clearTeachingCache);
  let calls = 0;
  const input = inputFor(A.SENTENCE_CHECK);
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) return Response.json({ ok: false, error: { code: 'AI_PROVIDER_QUOTA', retryAfterSeconds: 120, message: env.GEMINI_API_KEY } }, { status: 429 });
    return Response.json({ ok: true, action: input.action, data: resultFor(input.action, input.context) }, { headers: { 'Server-Timing': 'attempts;desc="1"' } });
  });
  await assert.rejects(requestTeaching(input.action, input), (error) => /Gemini API/.test(error.message) && error.retryAfterSeconds === 120);
  assert.equal(calls, 1);
  await requestTeaching(input.action, input); await requestTeaching(input.action, input); assert.equal(calls, 2);
  const measures = performance.getEntriesByName(`ai-teacher:${input.activity}:${input.action}`);
  assert.equal(measures.length, 1); assert.equal(measures[0].detail.attempts, 1);
  assert.ok(!JSON.stringify(measures[0].detail).includes(input.context.studentSentence));
});
