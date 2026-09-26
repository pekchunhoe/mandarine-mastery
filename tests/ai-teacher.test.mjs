import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearTeachingCache, paragraphTarget, requestTeaching } from '../js/ai-teacher.js';
import { TUTOR_ACTION as A, TUTOR_ACTIVITY as B } from '../js/tutor-actions.js';

test('paragraph target prefers selection, otherwise cursor, current paragraph then draft', () => {
  const value = '第一段。\n第二段。\n第三段。';
  assert.equal(paragraphTarget({ value, selectionStart: 1, selectionEnd: 3 }).text, '一段');
  assert.equal(paragraphTarget({ value, selectionStart: 6, selectionEnd: 6 }).text, '第二段。');
  assert.equal(paragraphTarget({ value, selectionStart: 0, selectionEnd: 0 }).text, '第一段。');
  assert.equal(paragraphTarget({ value }).text, value);
  assert.match(paragraphTarget(null, value).label, /当前写作段落/);
});
test('client does not serialize unrelated state and only uses same-origin endpoint', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/gemini');
    assert.equal(options.credentials, 'omit');
    assert.deepEqual(JSON.parse(options.body), {
      action: A.SENTENCE_HINT,
      activity: B.SENTENCE,
      context: { situation: '运动会', studentSentence: '小明跑得很快。' },
    });
    return Response.json({
      ok: true,
      action: A.SENTENCE_HINT,
      data: { thinkingQuestions: ['想一想'], usefulPatterns: [], studentTask: '自己写一句。' },
    });
  });
  await requestTeaching(A.SENTENCE_HINT, {
    activity: B.SENTENCE,
    context: {
      situation: '运动会',
      studentSentence: '小明跑得很快。',
      email: 'private@example.com',
    },
    email: 'private@example.com',
  });
});
test('client hides raw error and handles malformed/network responses', async (t) => {
  clearTeachingCache();
  t.after(clearTeachingCache);
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ ok: false, error: { message: 'raw-secret' } }, { status: 503 }),
  );
  await assert.rejects(
    requestTeaching(A.SENTENCE_HINT, {
      activity: B.SENTENCE,
      context: { studentSentence: '我去学校。' },
    }),
    /暂时无法联系/,
  );
  globalThis.fetch = async () => {
    throw Error('network-secret');
  };
  await assert.rejects(
    requestTeaching(A.SENTENCE_HINT, {
      activity: B.SENTENCE,
      context: { studentSentence: '我去学校。' },
    }),
    /暂时无法联系/,
  );
});
test('client caches only identical successful requests for five minutes', async (t) => {
  clearTeachingCache();
  t.after(clearTeachingCache);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({
      ok: true,
      action: A.SENTENCE_HINT,
      data: { thinkingQuestions: ['想一想'], usefulPatterns: [], studentTask: '自己写一句。' },
    });
  });
  const payload = {
    activity: B.SENTENCE,
    context: { situation: '运动会', studentSentence: '小明跑得很快。' },
  };
  const first = await requestTeaching(A.SENTENCE_HINT, payload);
  first.thinkingQuestions[0] = 'changed outside the cache';
  assert.deepEqual(await requestTeaching(A.SENTENCE_HINT, payload), {
    thinkingQuestions: ['想一想'],
    usefulPatterns: [],
    studentTask: '自己写一句。',
  });
  await requestTeaching(A.SENTENCE_HINT, {
    ...payload,
    context: { ...payload.context, studentSentence: '小明跑得更快。' },
  });
  assert.equal(calls, 2);
});
test('paragraph cache stays scoped to the current paragraph', async (t) => {
  clearTeachingCache();
  t.after(clearTeachingCache);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    calls++;
    const request = JSON.parse(options.body);
    assert.equal(request.action, A.PARAGRAPH_REVIEW);
    assert.ok(!Object.hasOwn(request.context, 'studentEssay'));
    return Response.json({
      ok: true,
      action: A.PARAGRAPH_REVIEW,
      data: {
        strengths: ['内容清楚。'],
        issues: [{ type: '内容', text: '补充一个细节。', suggestions: ['想想动作。'] }],
        missingDetails: [],
        revisionFocus: '先补充动作。',
        studentTask: '选择一个建议，自己修改这一段。',
      },
    });
  });
  const paragraph2 = {
    activity: B.ESSAY,
    context: {
      essayTitle: '森林里的声音',
      keyPoints: ['事情的经过'],
      previousParagraphs: ['星期六早上，我和弟弟到森林里散步。'],
      currentParagraph: '我们走到树林深处时，突然听见一阵奇怪的声音。',
      currentStep: 2,
    },
  };
  await requestTeaching(A.PARAGRAPH_REVIEW, paragraph2);
  await requestTeaching(A.PARAGRAPH_REVIEW, paragraph2);
  await requestTeaching(A.PARAGRAPH_REVIEW, {
    ...paragraph2,
    context: {
      ...paragraph2.context,
      previousParagraphs: [paragraph2.context.currentParagraph],
      currentParagraph: '后来我们才发现，原来是一只小猫躲在草丛里。',
      currentStep: 3,
    },
  });
  assert.equal(calls, 2);
});
test('client accepts a controlled rate-limit cooldown only when the server supplies one', async (t) => {
  clearTeachingCache();
  t.after(clearTeachingCache);
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json(
      { ok: false, error: { code: 'AI_RATE_LIMIT', retryAfterSeconds: 12 } },
      { status: 429 },
    ),
  );
  await assert.rejects(
    requestTeaching(A.SENTENCE_HINT, {
      activity: B.SENTENCE,
      context: { situation: '运动会', studentSentence: '小明跑得很快。' },
    }),
    (error) => error.retryAfterSeconds === 12 && /12 秒/.test(error.message),
  );
});
