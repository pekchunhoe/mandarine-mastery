import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTeacherHandler } from '../server/ai-handler.js';
import { resolveVocabularyResult } from '../server/ai-vocabulary.js';
import { TUTOR_ACTION as A, TUTOR_ACTIVITY as B, tutorRequest } from '../js/tutor-actions.js';
import { requestTeaching, clearTeachingCache, CACHE_TTL_MS } from '../js/ai-teacher.js';
import { tutorResultHTML } from '../components/ai-teacher.js';
import { resultFor } from './tutor-fixtures.mjs';
const records = ['紧张', '害怕', '小心翼翼'].map((word, index) => ({
  id: `local-${index}`,
  word,
  pinyin: 'jǐn zhāng',
  definitionChinese: '词库中的权威释义。',
  exampleSentence: `我感到${word}。`,
  synonyms: index === 0 ? ['紧绷'] : [],
  generatedSynonyms: index === 0 ? '紧绷' : '',
}));
const store = {
  getWordById: (id) => records.find((word) => word.id === id),
  getAllWords: () => records,
};
const supplement = (word) => ({
  word,
  pinyin: 'bǐng zhù hū xī',
  definitionChinese: '暂时不呼吸，不发出声音。',
  exampleSentence: `我躲在树后，${word}。`,
  reason: '适合描写躲藏时的紧张心情。',
});
const selection = (id) => ({
  vocabularyId: id,
  reason: '适合紧张的情境。',
  exampleUsage: '我紧张地躲在树后。',
});
const raw = () => ({
  recommendations: [selection('local-0'), selection('local-2')],
  supplementalVocabulary: ['屏住呼吸', '蹑手蹑脚', '心怦怦直跳'].map(supplement),
  studentTask: '选一个好词，自己写一句话。',
});
const context = {
  studentSentence: '我躲在大树后面，听见脚步声越来越近。',
  availableVocabularyIds: records.map((word) => word.id),
};
const endpoint = (generate) =>
  createTeacherHandler({
    env: { GEMINI_API_KEY: 'test-secret' },
    logger: {},
    vocabulary: async () => store,
    generate,
  });
const request = (context) =>
  new Request('http://localhost/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: A.VOCABULARY_HELP, activity: B.SENTENCE, context }),
  });

test('hybrid endpoint resolves authoritative local IDs and supplements without IDs on FAST', async () => {
  const handler = endpoint(async (input, options) => {
    assert.equal(options.model, 'gemini-3.5-flash-lite');
    assert.equal(input.context.studentSentence, context.studentSentence);
    assert.equal(input.vocabularyCandidates.length, 3);
    return JSON.stringify(raw());
  });
  const response = await handler(request(context));
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.recommendations.length, 5);
  assert.deepEqual(data.recommendations[0].vocabulary, records[0]);
  assert.equal(data.recommendations[0].source, 'library');
  for (const item of data.recommendations.slice(2)) {
    assert.equal(item.source, 'ai');
    assert.equal(item.vocabularyId, undefined);
    assert.equal(item.vocabulary.id, undefined);
    assert.ok(
      tutorResultHTML(A.VOCABULARY_HELP, data).includes(`data-speak="${item.vocabulary.word}"`),
    );
  }
});
test('duplicates, authoritative synonyms, invalid supplements and invented IDs are safely filtered', () => {
  const value = raw();
  value.recommendations.push(selection('invented'), selection('local-0'));
  value.supplementalVocabulary = [
    supplement('紧张'),
    supplement('害怕'),
    supplement('紧绷'),
    supplement('屏住呼吸'),
    supplement('屏住呼吸'),
    { ...supplement('bad'), word: 'English only' },
    { word: '残缺' },
    { ...supplement('错误'), pinyin: '123' },
  ];
  const { data, cacheable } = resolveVocabularyResult(value, [records[0], records[2]], store);
  assert.equal(cacheable, false);
  assert.deepEqual(
    data.recommendations.map((item) => item.vocabulary.word),
    ['紧张', '小心翼翼', '害怕', '屏住呼吸'],
  );
  assert.deepEqual(data.recommendations[2].vocabulary, records[1]);
  assert.equal(data.recommendations[2].source, 'library');
});
test('empty or irrelevant local candidate sets still reach Gemini and allow generated vocabulary', async () => {
  const handler = endpoint(async (input) => {
    assert.deepEqual(input.vocabularyCandidates, []);
    return JSON.stringify({ ...raw(), recommendations: [] });
  });
  const response = await handler(request({ ...context, availableVocabularyIds: [] }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.recommendations.length, 3);
});
test('malformed Chinese, definition, example and pinyin are removed without discarding valid cards', () => {
  for (const patch of [
    { word: '' },
    { word: '文'.repeat(17) },
    { definitionChinese: 'English' },
    { exampleSentence: '没有用到推荐词。' },
    { pinyin: '' },
    { reason: '' },
    { definitionChinese: '' },
  ]) {
    const value = raw();
    value.supplementalVocabulary.push({ ...supplement('错误'), ...patch });
    const result = resolveVocabularyResult(value, records, store);
    assert.equal(result.data.recommendations.length, 5);
    assert.equal(result.cacheable, false);
  }
});
test('vocabulary and paragraph cache varies with writing context, expires at five minutes, excludes malformed and filtered responses', async (t) => {
  t.after(clearTeachingCache);
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  for (const action of [A.VOCABULARY_HELP, A.PARAGRAPH_EXPAND, A.PARAGRAPH_VIVID]) {
    clearTeachingCache();
    let calls = 0;
    let cacheable = true;
    let malformed = false;
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      return Response.json({
        ok: true,
        action,
        cacheable,
        data: malformed
          ? {}
          : action === A.VOCABULARY_HELP
            ? resolveVocabularyResult(raw(), records, store).data
            : resultFor(action),
      });
    });
    const payload = {
      activity: B.ESSAY,
      context: {
        essayTitle: '森林里的声音',
        keyPoints: ['事情经过'],
        currentParagraph: context.studentSentence,
        currentStep: 2,
      },
    };
    await requestTeaching(action, payload);
    await requestTeaching(action, payload);
    assert.equal(calls, 1);
    for (const patch of [
      { essayTitle: '新的题目' },
      { keyPoints: ['人物反应'] },
      { currentParagraph: '后来发现原来是一只小猫。' },
    ])
      await requestTeaching(action, { ...payload, context: { ...payload.context, ...patch } });
    assert.equal(calls, 4);
    t.mock.timers.tick(CACHE_TTL_MS + 1);
    await requestTeaching(action, payload);
    assert.equal(calls, 5);
    clearTeachingCache();
    cacheable = false;
    await requestTeaching(action, payload);
    await requestTeaching(action, payload);
    assert.equal(calls, 7);
    malformed = true;
    await assert.rejects(requestTeaching(action, payload));
    await assert.rejects(requestTeaching(action, payload));
    assert.equal(calls, 9);
  }
});
test('paragraph actions exclude essay and future paragraphs and locally reject trivial text', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('No network for invalid paragraphs'));
  for (const action of [A.PARAGRAPH_EXPAND, A.PARAGRAPH_VIVID]) {
    const clean = tutorRequest(action, B.ESSAY, {
      essayTitle: '森林里的声音',
      keyPoints: ['事情经过'],
      currentParagraph: context.studentSentence,
      previousParagraphs: ['更早的段落', '紧邻上一段'],
      studentEssay: '整篇作文含未来段落',
    });
    assert.deepEqual(clean.context.previousParagraphs, ['紧邻上一段']);
    assert.equal(clean.context.studentEssay, undefined);
    await assert.rejects(
      requestTeaching(action, { activity: B.ESSAY, context: { currentParagraph: '' } }),
      /开头/,
    );
  }
  await assert.rejects(
    requestTeaching(A.PARAGRAPH_VIVID, {
      activity: B.ESSAY,
      context: { currentParagraph: '害怕' },
    }),
    /至少 6 字/,
  );
});
