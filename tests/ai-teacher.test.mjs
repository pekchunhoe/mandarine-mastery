import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paragraphTarget, requestTeaching } from '../js/ai-teacher.js';
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
      data: { thinkingQuestions: ['想一想'] },
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
