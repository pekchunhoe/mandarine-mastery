import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validKeywordSentences, validSentenceKeywordResult } from '../js/sentence-keyword.js';
import { sentenceKeywordInstruction, actions } from '../server/ai-contract.js';
import { createTeacherHandler } from '../server/ai-handler.js';
import { createTutorLimiter } from '../server/ai-rate-limit.js';
import { requestTeaching, clearTeachingCache } from '../js/ai-teacher.js';
import { TUTOR_ACTION as A, TUTOR_ACTIVITY as B, activityTutorActions, localTutorResult } from '../js/tutor-actions.js';
import { resultFor, word } from './tutor-fixtures.mjs';
import { tutorResultHTML } from '../components/ai-teacher.js';

const targets = ['坚持', '勇敢', '保护环境', '兴高采烈', '因为……所以……'];
const inputFor = (action, topic) => ({ action, activity: B.SENTENCE, context: {
  topic, situation: '在学校', studentSentence: '我和同学一起参加活动。',
  ...(action === A.VOCABULARY_HELP ? { availableVocabularyIds: [word.id] } : {}),
} });
const req = (input, signal) => new Request('http://localhost/api/gemini', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal,
});
const handler = (options = {}) => createTeacherHandler({
  env: { GEMINI_API_KEY: 'mock-only' }, logger: { info() {}, warn() {} },
  vocabulary: async () => ({ getWordById: () => word }), ...options,
});

test('exact matching checks every sentence, preserves literal punctuation and rejects synonyms or reordered characters', () => {
  assert.ok(validKeywordSentences('我每天坚持练习。姐姐也坚持练习！', '坚持'));
  assert.ok(validKeywordSentences('「我每天坚持练习。」', '坚持'));
  assert.ok(validKeywordSentences('我每天坚持在8.30开始练习。', '坚持'));
  for (const text of ['我每天努力练习。', '我每天持坚练习。', '我坚 持练习。', '我每天坚持练习。姐姐努力练习！', '我每天坚持练习.姐姐努力练习.'])
    assert.equal(validKeywordSentences(text, '坚持'), false, text);
  assert.equal(validKeywordSentences('我会用“因为……所以……”说明原因。', '因为……所以……'), true);
  assert.equal(validKeywordSentences('因为下雨，所以活动取消了。', '因为……所以……'), false);
  assert.equal(validKeywordSentences('我每天努力练习。\u0000', '坚持'), false);
});

test('all five teacher actions use exact targets in prompts, structured examples and local hints', async () => {
  for (const topic of targets) for (const action of activityTutorActions[B.SENTENCE]) {
    const input = inputFor(action, topic);
    const prompt = sentenceKeywordInstruction(input);
    assert.ok(prompt.includes(JSON.stringify(topic)));
    assert.match(prompt, /省略、替换、拆开|马来西亚|原句没有包含/);
    assert.ok(actions[action].instruction);
    const data = resultFor(action, input.context);
    assert.equal(validSentenceKeywordResult(action, data, topic), true, `${action}:${topic}`);
    let calls = 0;
    const response = await handler({ generate: async () => { calls++; return JSON.stringify(data); } })(req(input));
    assert.equal(response.status, 200, `${action}:${topic}`);
    assert.equal(calls, 1);
    const local = localTutorResult(A.SENTENCE_HINT, { topic });
    assert.ok(JSON.stringify(local).includes(topic));
    assert.ok(validSentenceKeywordResult(A.SENTENCE_HINT, local, topic));
  }
});

test('explanations and original errors need not contain target, but individually invalid models are rejected', () => {
  const data = resultFor(A.SENTENCE_CHECK, { topic: '坚持' });
  data.suggestedRevision = '我每天坚持练习写字。';
  data.issues = [{ text: '这里少了指定词语。', explanation: '请想想怎样修改。' }];
  assert.ok(validSentenceKeywordResult(A.SENTENCE_CHECK, data, '坚持'));
  data.suggestedRevision += '我不会放弃。';
  assert.equal(validSentenceKeywordResult(A.SENTENCE_CHECK, data, '坚持'), false);
  data.suggestedRevision = '';
  data.issues[0].explanation = '例如：“我每天努力练习写字。”';
  assert.equal(validSentenceKeywordResult(A.SENTENCE_CHECK, data, '坚持'), false);
  data.issues[0].explanation = '例如：我每天努力练习写字。';
  assert.equal(validSentenceKeywordResult(A.SENTENCE_CHECK, data, '坚持'), false);
  data.issues[0].explanation = '可以试试“我每天努力练习写字。”';
  assert.equal(validSentenceKeywordResult(A.SENTENCE_CHECK, data, '坚持'), false);
  data.issues[0].explanation = `原句“${data.original}”缺少目标词。`;
  assert.equal(validSentenceKeywordResult(A.SENTENCE_CHECK, data, '坚持'), true);
});

test('every suggested correction, expansion, rewrite, template and vocabulary example is validated', () => {
  for (const action of activityTutorActions[B.SENTENCE]) {
    const data = resultFor(action, { topic: '保护环境' });
    const invalid = '我们应该爱护大自然。';
    if (action === A.SENTENCE_HINT) data.usefulPatterns.push(invalid);
    if (action === A.SENTENCE_CHECK) data.suggestedRevision = invalid;
    if (action === A.SENTENCE_EXPAND) data.levels[1].example = invalid;
    if (action === A.SENTENCE_VIVID) data.example += invalid;
    if (action === A.VOCABULARY_HELP) data.recommendations[0].exampleUsage = invalid;
    assert.equal(validSentenceKeywordResult(action, data, '保护环境'), false, action);
  }
});

test('server retries invalid keyword output once, validates again and returns friendly failure or corrected output', async () => {
  for (const recover of [false, true]) {
    let calls = 0, acquired = 0, released = 0;
    const input = inputFor(A.SENTENCE_EXPAND, '保护环境');
    const response = await handler({
      limiter: { acquire() { acquired++; return () => released++; } },
      generate: async (received) => {
        calls++;
        assert.equal(received.context.topic, '保护环境');
        assert.equal(!!received.keywordRetry, calls === 2);
        const data = resultFor(A.SENTENCE_EXPAND, received.context);
        if (!recover || calls === 1) data.levels[1].example = '我们应该爱护大自然。';
        return JSON.stringify(data);
      },
    })(req(input));
    const result = await response.json();
    assert.equal(calls, 2);
    assert.equal(acquired, 2);
    assert.equal(released, 2);
    assert.equal(response.status, recover ? 200 : 502);
    if (recover) assert.ok(validSentenceKeywordResult(input.action, result.data, '保护环境'));
    else { assert.equal(result.error.code, 'AI_KEYWORD_MISSING'); assert.equal(result.data, undefined); }
  }
});

test('retry obeys existing quota, deadline and cancellation without issuing more upstream calls', async () => {
  const input = inputFor(A.SENTENCE_VIVID, '勇敢');
  const bad = resultFor(input.action, input.context); bad.example = '小明走上台演讲。';
  let calls = 0;
  const limited = await handler({ limiter: createTutorLimiter({ perClient: 1 }), generate: async () => {
    calls++; return JSON.stringify(bad);
  } })(req(input));
  assert.equal(limited.status, 429); assert.equal(calls, 1);
  calls = 0;
  const timed = await handler({ timeoutMs: 20, generate: async () => {
    calls++; return calls === 1 ? JSON.stringify(bad) : new Promise(() => {});
  } })(req(input));
  assert.equal(timed.status, 504); assert.equal(calls, 2);
  calls = 0;
  const caller = new AbortController();
  const cancelled = await handler({ generate: async () => {
    calls++; caller.abort(); return JSON.stringify(bad);
  } })(req(input, caller.signal));
  assert.equal(cancelled.status, 499); assert.equal(calls, 1);
});

test('supplemental vocabulary examples are checked before filtering and library dictionary examples are not shown as target models', async () => {
  let calls = 0;
  const input = inputFor(A.VOCABULARY_HELP, '保护环境');
  const data = resultFor(input.action, input.context);
  data.supplementalVocabulary = [{ word: '珍惜', pinyin: 'zhēn xī', definitionChinese: '重视并爱护。', reason: '表达爱护资源。', exampleSentence: '我们应该珍惜资源。' }];
  const response = await handler({ generate: async () => { calls++; return JSON.stringify(data); } })(req(input));
  assert.equal(response.status, 502); assert.equal(calls, 2);
  const resolved = resultFor(input.action, input.context, word, true);
  const html = tutorResultHTML(input.action, resolved, { keyword: '保护环境' });
  assert.ok(!html.includes(word.exampleSentence));
  assert.ok(html.includes(resolved.recommendations[0].exampleUsage));
});

test('browser rejects invalid success envelopes before rendering/caching and separates keyword cache entries', async (t) => {
  clearTeachingCache(); t.after(clearTeachingCache);
  let calls = 0, invalid = true;
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    calls++;
    const input = JSON.parse(options.body);
    const data = resultFor(input.action, input.context);
    if (invalid) data.example = '小明高兴地笑了。';
    return Response.json({ ok: true, action: input.action, data });
  });
  const input = inputFor(A.SENTENCE_VIVID, '兴高采烈');
  await assert.rejects(requestTeaching(input.action, input), /指定词语/);
  invalid = false;
  await requestTeaching(input.action, input);
  await requestTeaching(input.action, input);
  const other = inputFor(input.action, '勇敢');
  await requestTeaching(other.action, other);
  assert.equal(calls, 3);
});

test('guided essay prompts and model validation are unaffected by sentence target rules', async () => {
  const input = { action: A.PARAGRAPH_VIVID, activity: B.ESSAY, context: { selectedTitle: '保护环境', studentParagraph: '同学们在操场上捡垃圾。' } };
  assert.equal(sentenceKeywordInstruction(input), '');
  const response = await handler({ generate: async () => JSON.stringify(resultFor(input.action)) })(req(input));
  assert.equal(response.status, 200);
});
