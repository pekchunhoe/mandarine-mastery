import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TUTOR_ACTION as A,
  TUTOR_ACTIVITY as B,
  activityTutorActions,
  tutorRequest,
} from '../js/tutor-actions.js';
import { requestTeaching, clearTeachingCache } from '../js/ai-teacher.js';
import { actions, guidedTitleInstruction, validateInput } from '../server/ai-contract.js';
import { createTeacherHandler } from '../server/ai-handler.js';
import { selectGeminiModel, OUTPUT_TOKEN_CAPS, buildGenerationConfig } from '../server/gemini.js';
import { inputFor, resultFor, word } from './tutor-fixtures.mjs';

const title = '森林里的发现';
const story = [
  '星期六，我和弟弟走进森林，突然听见草丛里传来奇怪的声音。',
  '我们走近草丛，发现一只受伤的小猫，于是把它抱回家。',
  '后来小猫恢复了精神，我和弟弟都高兴地笑了。',
];
const scaffolds = {
  writingPoint: '在下雨天帮助老人',
  localHint: '描写公园、大雨、老人和雨伞。',
  hint: '老人',
  example: '我马上撑着雨伞扶老奶奶过马路。',
  modelParagraph: '过马路',
  passage: '雨伞',
  EssayContents: '下雨',
  topic: '老人',
  situation: '公园',
  studentSentence: '范句',
};
const input = (action) => ({
  action,
  activity: B.ESSAY,
  context: {
    selectedTitle: title,
    ...(action === A.PARAGRAPH_HINT
      ? {
          paragraphStage: 'ending',
          previousStudentParagraphs: story.slice(0, 2),
          currentStudentParagraph: story[2],
        }
      : action === A.ESSAY_REVIEW
        ? { studentEssay: story.join('\n\n') }
        : {
            studentParagraph: story[1],
            ...(action === A.VOCABULARY_HELP
              ? { availableVocabularyIds: [word.id] }
              : { previousStudentParagraph: story[0] }),
          }),
  },
});
const request = (payload) =>
  new Request('http://localhost/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

for (const action of activityTutorActions[B.ESSAY]) {
  test(`${action}: selected title and student context survive server validation, scaffold stays out of requests and logs`, async () => {
    const payload = input(action),
      logs = [];
    let calls = 0;
    const handler = createTeacherHandler({
      env: { GEMINI_API_KEY: 'fake-title-test-secret' },
      logger: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
      vocabulary: async () => ({ getWordById: () => word }),
      generate: async (actual, options) => {
        calls++;
        const expected = structuredClone(payload.context);
        delete expected.availableVocabularyIds;
        assert.deepEqual(actual.context, expected);
        assert.equal(
          options.model,
          [A.PARAGRAPH_REVIEW, A.ESSAY_REVIEW].includes(action)
            ? 'gemini-3.6-flash'
            : 'gemini-3.5-flash-lite',
        );
        return JSON.stringify(resultFor(action));
      },
    });
    assert.equal(
      (await handler(request({ ...payload, context: { ...payload.context, ...scaffolds } })))
        .status,
      200,
    );
    assert.equal(calls, 1);
    for (const text of [title, ...story, ...Object.values(scaffolds), 'fake-title-test-secret'])
      assert.ok(!JSON.stringify(logs).includes(text));
  });

  test(`${action}: absent, blank and invalid titles never reach client network or provider`, async (t) => {
    t.mock.method(globalThis, 'fetch', () => assert.fail('No network without valid title'));
    const handler = createTeacherHandler({
      env: { GEMINI_API_KEY: 'fake' },
      logger: {},
      generate: () => assert.fail('No provider call'),
    });
    for (const selectedTitle of [undefined, '', ' \n ', '《》。，', null, 12, '题'.repeat(161)]) {
      const payload = input(action);
      payload.context.selectedTitle = selectedTitle;
      await assert.rejects(
        requestTeaching(action, payload),
        (selectedTitle == null && selectedTitle !== undefined) ||
          typeof selectedTitle === 'number' ||
          selectedTitle?.length > 160
          ? /格式|太长/
          : /请先选择作文题目/,
      );
      const response = await handler(request(payload));
      assert.equal(response.status, selectedTitle?.length > 160 ? 413 : 400);
      if (
        selectedTitle === undefined ||
        selectedTitle === '' ||
        selectedTitle === ' \n ' ||
        selectedTitle === '《》。，'
      )
        assert.equal((await response.json()).error.code, 'TITLE_REQUIRED');
    }
  });

  test(`${action}: cache varies with title, student text and relevant prior writing, never scaffold`, async (t) => {
    clearTeachingCache();
    t.after(clearTeachingCache);
    const sent = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      sent.push(JSON.parse(options.body));
      return Response.json({ ok: true, action, data: resultFor(action, {}, word, true) });
    });
    const payload = input(action);
    await requestTeaching(action, payload);
    await requestTeaching(action, payload);
    for (const [field, value] of Object.entries(scaffolds))
      await requestTeaching(action, {
        ...payload,
        context: { ...payload.context, [field]: value },
      });
    assert.equal(sent.length, 1);
    const changedTitle = {
      ...payload,
      context: { ...payload.context, selectedTitle: '难忘的一天' },
    };
    await requestTeaching(action, changedTitle);
    assert.equal(sent.length, 2);
    assert.equal(sent[1].context.selectedTitle, '难忘的一天');
    assert.ok(!JSON.stringify(sent[1]).includes(title));
    const field =
      action === A.PARAGRAPH_HINT
        ? 'currentStudentParagraph'
        : action === A.ESSAY_REVIEW
          ? 'studentEssay'
          : 'studentParagraph';
    await requestTeaching(action, {
      ...payload,
      context: { ...payload.context, [field]: payload.context[field] + '我们仔细听了听。' },
    });
    assert.equal(sent.length, 3);
    if (action === A.PARAGRAPH_HINT) {
      for (let index = 0; index < 2; index++) {
        const previousStudentParagraphs = [...payload.context.previousStudentParagraphs];
        previousStudentParagraphs[index] += '我轻轻叫了一声。';
        await requestTeaching(action, {
          ...payload,
          context: { ...payload.context, previousStudentParagraphs },
        });
      }
      assert.equal(sent.length, 5);
    } else if (payload.context.previousStudentParagraph) {
      await requestTeaching(action, {
        ...payload,
        context: { ...payload.context, previousStudentParagraph: '我和妹妹一起来到树林里。' },
      });
      assert.equal(sent.length, 4);
    }
  });
}

test('guided prompts anchor relevance semantically without overcorrection; schemas and route caps remain unchanged', () => {
  for (const action of activityTutorActions[B.ESSAY]) {
    assert.ok(actions[action].instruction.includes(guidedTitleInstruction));
    assert.match(actions[action].instruction, /selectedTitle/);
  }
  assert.match(guidedTitleInstruction, /不是机械匹配关键词/);
  assert.match(guidedTitleInstruction, /只有关联明显薄弱/);
  assert.match(guidedTitleInstruction, /不强行编造新情节/);
  assert.match(actions[A.PARAGRAPH_REVIEW].instruction, /type为切题/);
  assert.match(actions[A.ESSAY_REVIEW].instruction, /categories.topicRelevance/);
  assert.match(actions[A.ESSAY_NEXT_STEP].instruction, /不无限延长无关故事/);
  assert.match(actions[A.PARAGRAPH_EXPAND].instruction, /不能凭空制造/);
  for (const [action, cap] of Object.entries({
    paragraph_hint: 650,
    vocabulary_help: 1400,
    paragraph_expand: 800,
    paragraph_vivid: 800,
    essay_next_step: 480,
    paragraph_review: 1200,
    essay_review: 1800,
  })) {
    assert.equal(OUTPUT_TOKEN_CAPS[action], cap);
    const advanced = [A.PARAGRAPH_REVIEW, A.ESSAY_REVIEW].includes(action);
    assert.equal(selectGeminiModel(action).routeClass, advanced ? 'advanced' : 'fast');
    assert.deepEqual(buildGenerationConfig({ action }), {
      max_output_tokens: cap,
      ...(advanced ? { thinking_level: 'minimal' } : {}),
    });
  }
});

test('sentence contracts are unchanged, while a valid title does not bypass meaningful essay writing requirements', async (t) => {
  for (const action of activityTutorActions[B.SENTENCE]) {
    const payload = inputFor(action);
    assert.deepEqual(
      validateInput({ ...payload, context: { ...payload.context, selectedTitle: title } }),
      validateInput(payload),
    );
    if (action !== A.VOCABULARY_HELP)
      assert.ok(!actions[action].instruction.includes(guidedTitleInstruction));
  }
  t.mock.method(globalThis, 'fetch', () => assert.fail('No network for empty writing'));
  for (const action of activityTutorActions[B.ESSAY].filter(
    (action) => action !== A.PARAGRAPH_HINT,
  )) {
    const payload = input(action),
      field = action === A.ESSAY_REVIEW ? 'studentEssay' : 'studentParagraph';
    for (const value of ['', ' ，。\n'])
      await assert.rejects(
        requestTeaching(action, { ...payload, context: { ...payload.context, [field]: value } }),
      );
  }
  assert.doesNotThrow(() =>
    tutorRequest(A.PARAGRAPH_HINT, B.ESSAY, {
      selectedTitle: title,
      paragraphStage: 'opening',
      previousStudentParagraphs: [],
    }),
  );
});
