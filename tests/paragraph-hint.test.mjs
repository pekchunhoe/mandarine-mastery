import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tutorRequest, TUTOR_ACTION as A, TUTOR_ACTIVITY as B } from '../js/tutor-actions.js';
import { requestTeaching, clearTeachingCache } from '../js/ai-teacher.js';
import { createTeacherHandler } from '../server/ai-handler.js';
import { FAST_ACTIONS, OUTPUT_TOKEN_CAPS, selectGeminiModel } from '../server/gemini.js';
import { resultFor } from './tutor-fixtures.mjs';

const context = {
  selectedTitle: '森林里的发现',
  paragraphStage: 'ending',
  previousStudentParagraphs: [
    '我和弟弟到森林里散步，听见草丛里传来声音。',
    '我们发现一只受伤的小猫，把它抱回家。',
  ],
  currentStudentParagraph: '看着小猫恢复精神，',
};
const payload = (fields = {}) => ({ activity: B.ESSAY, context: { ...context, ...fields } });

test('paragraph hint contract allows only title and ordered student story with bounded, validated stages', () => {
  const request = tutorRequest(A.PARAGRAPH_HINT, B.ESSAY, {
    ...context,
    writingPoint: '下雨天帮助老人',
    hint: '公园',
    localHint: '雨伞',
    example: '范句',
    modelSentence: '范句',
    modelParagraph: '范文',
    passage: '范文',
    EssayContents: '秘密',
  });
  assert.deepEqual(request.context, context);
  assert.throws(() => tutorRequest(A.PARAGRAPH_HINT, B.SENTENCE, context));
  for (const fields of [
    { paragraphStage: 'middle' },
    { paragraphStage: 1 },
    { selectedTitle: '' },
    { previousStudentParagraphs: {} },
    { previousStudentParagraphs: [null] },
    { previousStudentParagraphs: Array(21).fill('故事') },
    { previousStudentParagraphs: ['文'.repeat(2001)] },
    { currentStudentParagraph: '文'.repeat(2001) },
    {
      previousStudentParagraphs: [
        '文'.repeat(2000),
        '文'.repeat(2000),
        '文'.repeat(2000),
        '文'.repeat(2000),
      ],
    },
    { paragraphStage: 'opening' },
  ])
    assert.throws(() => tutorRequest(A.PARAGRAPH_HINT, B.ESSAY, { ...context, ...fields }));
  assert.deepEqual(
    tutorRequest(A.PARAGRAPH_HINT, B.ESSAY, {
      selectedTitle: '森林里的发现',
      paragraphStage: 'opening',
      previousStudentParagraphs: [],
    }).context,
    {
      selectedTitle: '森林里的发现',
      paragraphStage: 'opening',
      previousStudentParagraphs: [],
      currentStudentParagraph: '',
    },
  );
});

test('paragraph hint cache depends on title, stage, previous story and partial work, never scaffold', async (t) => {
  clearTeachingCache();
  t.after(clearTeachingCache);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ ok: true, action: A.PARAGRAPH_HINT, data: resultFor(A.PARAGRAPH_HINT) });
  });
  await requestTeaching(A.PARAGRAPH_HINT, payload());
  for (const name of ['writingPoint', 'example', 'localHint']) {
    await requestTeaching(A.PARAGRAPH_HINT, payload({ [name]: '下雨天在公园帮助老人' }));
    assert.equal(calls, 1);
  }
  for (const fields of [
    { selectedTitle: '难忘的一天' },
    { previousStudentParagraphs: ['我和姐姐去森林。', context.previousStudentParagraphs[1]] },
    {
      previousStudentParagraphs: [context.previousStudentParagraphs[0], '我们把小猫送到兽医那里。'],
    },
    { currentStudentParagraph: '我们都笑了。' },
    {
      paragraphStage: 'result',
      previousStudentParagraphs: context.previousStudentParagraphs.slice(0, 1),
    },
  ])
    await requestTeaching(A.PARAGRAPH_HINT, payload(fields));
  assert.equal(calls, 6);
});

test('missing meaningful prior writing avoids client network and server generation', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('No network for missing story'));
  const handler = createTeacherHandler({
    env: { GEMINI_API_KEY: 'fake' },
    logger: {},
    generate: () => assert.fail('No generation'),
  });
  for (const fields of [
    { paragraphStage: 'result', previousStudentParagraphs: [] },
    { paragraphStage: 'result', previousStudentParagraphs: [' ，。 \n'] },
    { previousStudentParagraphs: [context.previousStudentParagraphs[0], ''] },
    { previousStudentParagraphs: ['', context.previousStudentParagraphs[1]] },
  ]) {
    await assert.rejects(requestTeaching(A.PARAGRAPH_HINT, payload(fields)), /先.*开头/);
    const response = await handler(
      new Request('http://localhost/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: A.PARAGRAPH_HINT, ...payload(fields) }),
      }),
    );
    assert.equal(response.status, 400);
  }
});

test('paragraph hint routes once to FAST at 650 tokens and rejects oversized paragraph examples', async (t) => {
  assert.ok(FAST_ACTIONS.has(A.PARAGRAPH_HINT));
  assert.equal(OUTPUT_TOKEN_CAPS[A.PARAGRAPH_HINT], 650);
  assert.deepEqual(selectGeminiModel(A.PARAGRAPH_HINT), {
    model: 'gemini-3.5-flash-lite',
    routeClass: 'fast',
  });
  for (const malformed of [
    { ideas: ['只有一个想法'] },
    { examples: ['文'.repeat(81)] },
    { examples: ['第一句。第二句。第三句。'] },
    { examples: ['第一段。\n第二段。'] },
    { examples: [] },
    { completedParagraph: '完整段落' },
  ]) {
    const data = { ...resultFor(A.PARAGRAPH_HINT), ...malformed };
    let calls = 0;
    const handler = createTeacherHandler({
      env: { GEMINI_API_KEY: 'fake' },
      logger: {},
      generate: async (input, options) => {
        calls++;
        assert.equal(options.model, 'gemini-3.5-flash-lite');
        return JSON.stringify(data);
      },
    });
    const response = await handler(
      new Request('http://localhost/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: A.PARAGRAPH_HINT, ...payload() }),
      }),
    );
    assert.equal(response.status, 502);
    assert.equal(calls, 1);
    clearTeachingCache();
    const mock = t.mock.method(globalThis, 'fetch', async () =>
      Response.json({ ok: true, action: A.PARAGRAPH_HINT, data }),
    );
    await assert.rejects(requestTeaching(A.PARAGRAPH_HINT, payload()), /回复不完整/);
    await assert.rejects(requestTeaching(A.PARAGRAPH_HINT, payload()), /回复不完整/);
    assert.equal(mock.mock.callCount(), 2, 'malformed responses never cached');
    mock.mock.restore();
  }
});
