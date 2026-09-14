import { test } from 'node:test';
import assert from 'node:assert/strict';
import titles from '../data/essay-titles.json' with { type: 'json' };
import contents from '../data/essay-contents.json' with { type: 'json' };
import {
  getActiveEssayContentsByEssayId,
  getEssayContentsByEssayId,
} from '../js/essay-content-service.js';
import {
  deriveEssayTraining,
  sentenceCue,
  splitEssayParagraphs,
  writingLengthGuidance,
} from '../js/essay-training-service.js';
import { copyEssayText, guidedEssayWriting, modelEssayStudy } from '../activities/essayTraining.js';
import {
  deriveEssaySentences,
  resolveReferenceParagraph,
  splitChineseSentences,
} from '../js/essay-sentence-service.js';
import { state } from '../js/state.js';

test('Chinese sentence tokenizer retains punctuation, quotes, final fragments and paragraphs', () => {
  assert.deepEqual(splitChineseSentences('今天是星期天。我和家人去公园。天气很好！'), [
    '今天是星期天。',
    '我和家人去公园。',
    '天气很好！',
  ]);
  assert.deepEqual(splitChineseSentences('你今天开心吗？我很开心。'), [
    '你今天开心吗？',
    '我很开心。',
  ]);
  assert.deepEqual(splitChineseSentences('妈妈说：“快来吃饭吧！”我马上跑过去。'), [
    '妈妈说：“快来吃饭吧！”',
    '我马上跑过去。',
  ]);
  assert.deepEqual(splitChineseSentences('我想了很久……最后，我明白了。'), [
    '我想了很久……',
    '最后，我明白了。',
  ]);
  assert.deepEqual(splitChineseSentences('这是最后一句'), ['这是最后一句']);
  assert.deepEqual(splitChineseSentences('数字3.5和10.30不会分句。'), ['数字3.5和10.30不会分句。']);
  assert.deepEqual(deriveEssaySentences('第一段第一句。第一段第二句。\n\n第二段第一句。'), [
    { paragraphIndex: 0, sentenceIndex: 0, text: '第一段第一句。' },
    { paragraphIndex: 0, sentenceIndex: 1, text: '第一段第二句。' },
    { paragraphIndex: 1, sentenceIndex: 0, text: '第二段第一句。' },
  ]);
});

test('guided essay copy uses the complete current draft without changing it', async () => {
  const draft =
    '放学后，我和同学一起整理图书角。\n\n我们把图书分类放好，教室变得整整齐齐。\n\n看着大家的成果，我很开心。';
  const copied = [];
  const before = draft;
  assert.equal(
    await copyEssayText(draft, {
      navigatorRef: { clipboard: { writeText: async (text) => copied.push(text) } },
    }),
    true,
  );
  assert.deepEqual(copied, [draft]);
  assert.equal(
    copied[0],
    '放学后，我和同学一起整理图书角。\n\n我们把图书分类放好，教室变得整整齐齐。\n\n看着大家的成果，我很开心。',
  );
  assert.equal(draft, before);
});

test('guided essay copy falls back safely and does not copy an empty draft', async () => {
  let appended = false,
    removed = false,
    selected = false;
  const field = {
    value: '',
    style: {},
    setAttribute() {},
    focus() {},
    select() {
      selected = true;
    },
    remove() {
      removed = true;
    },
  };
  const documentRef = {
    body: {
      appendChild(node) {
        appended = node === field;
      },
    },
    createElement(tag) {
      assert.equal(tag, 'textarea');
      return field;
    },
    execCommand(command) {
      assert.equal(command, 'copy');
      return true;
    },
  };
  assert.equal(
    await copyEssayText('最新一段。\n\n下一段。', {
      navigatorRef: {
        clipboard: {
          writeText: async () => {
            throw new Error('denied');
          },
        },
      },
      documentRef,
    }),
    true,
  );
  assert.equal(field.value, '最新一段。\n\n下一段。');
  assert.equal(appended && selected && removed, true);
  assert.equal(
    await copyEssayText('', {
      navigatorRef: {
        clipboard: { writeText: async () => assert.fail('must not copy blank text') },
      },
    }),
    false,
  );
});

test('reference examples resolve to the complete source paragraph across supported line breaks', () => {
  const first = '第一句。第二句。第三句。';
  const second = '第二段第一句。第二段第二句。';
  for (const separator of ['\n', '\n\n', '\r\n']) {
    const essay = `${first}${separator}${second}`;
    assert.equal(
      resolveReferenceParagraph(essay, { paragraphIndex: 0, referenceSentence: '第二句。' }),
      first,
    );
    assert.equal(
      resolveReferenceParagraph(essay, { paragraphIndex: 1, referenceSentence: '第二段第一句。' }),
      second,
    );
  }
});

test('reference examples select each matching paragraph without hardcoded content', () => {
  const essay = '开头第一句。开头第二句。\n\n经过第一句。经过第二句。\n\n结尾第一句。结尾第二句。';
  assert.equal(
    resolveReferenceParagraph(essay, { paragraphIndex: 0, referenceSentence: '开头第二句。' }),
    '开头第一句。开头第二句。',
  );
  assert.equal(
    resolveReferenceParagraph(essay, { paragraphIndex: 1, referenceSentence: '经过第一句。' }),
    '经过第一句。经过第二句。',
  );
  assert.equal(
    resolveReferenceParagraph(essay, { paragraphIndex: 2, referenceSentence: '结尾第二句。' }),
    '结尾第一句。结尾第二句。',
  );
  assert.equal(
    resolveReferenceParagraph(essay, { referenceSentence: '经过第二句。' }),
    '经过第一句。经过第二句。',
  );
  assert.equal(
    resolveReferenceParagraph(essay, { paragraphIndex: 9, referenceSentence: '不存在。' }),
    '不存在。',
  );
});

test('active workbook essay contents are present, linked, Unicode-safe and preserve paragraphs', () => {
  const activeTitles = titles.filter((title) => title.active);
  const activeContents = contents.filter((content) => content.active);
  const titleIds = new Set(titles.map((title) => title.id));
  assert.equal(activeTitles.length, 300);
  assert.equal(activeContents.length, 300);
  assert.equal(new Set(contents.map((content) => content.contentId)).size, contents.length);
  for (const content of activeContents) {
    assert.ok(titleIds.has(content.essayId));
    assert.ok(content.content.trim());
    assert.ok(!content.content.includes('\uFFFD'));
    assert.ok(splitEssayParagraphs(content.content).length > 1);
  }
});

test('training transformation preserves source text and creates variable-length paragraph scaffolds', () => {
  const content = contents.find((item) => item.essayId === titles[0].id);
  const original = content.content;
  const training = deriveEssayTraining(content, titles[0]);
  assert.equal(training.contentId, content.contentId);
  assert.equal(training.paragraphCount, splitEssayParagraphs(original).length);
  assert.equal(training.paragraphs.map((paragraph) => paragraph.text).join('\n\n'), original);
  assert.ok(
    training.paragraphs.every((paragraph) => paragraph.keyPoints.length && paragraph.sentenceCue),
  );
  assert.ok(
    training.paragraphs.every((paragraph) =>
      paragraph.keyPoints.every((point) => point.length <= paragraph.text.length),
    ),
  );
  assert.equal(content.content, original);
});

test('sentence clues stay scaffolded and writing length guidance uses the 150–600 allowed range', () => {
  assert.equal(sentenceCue('有一次我的脚车链条掉了，我急着叫爸爸帮我。'), '有一次，__________。');
  assert.match(sentenceCue('妈妈每天都很忙。'), /__________/);
  assert.match(writingLengthGuidance(149), /太短/);
  assert.match(writingLengthGuidance(250), /推荐/);
  assert.match(writingLengthGuidance(500), /完整/);
  assert.match(writingLengthGuidance(601), /偏长/);
});

test('essay content service supports multiple versions without exposing inactive content', () => {
  const content = contents[0];
  assert.equal(getActiveEssayContentsByEssayId(content.essayId)[0].contentId, content.contentId);
  assert.ok(
    getEssayContentsByEssayId(content.essayId).length >=
      getActiveEssayContentsByEssayId(content.essayId).length,
  );
});

test('model study renders the selected model while guided writing keeps it hidden until reveal', () => {
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = { setItem() {} };
  const topic = titles.find((item) => item.gradeMin === 3),
    content = contents.find((item) => item.essayId === topic.id);
  const fakeRoot = () => ({
    innerHTML: '',
    listeners: {},
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    },
  });
  try {
    const studyRoot = fakeRoot();
    modelEssayStudy(studyRoot, { params: new URLSearchParams(`topic=${topic.id}`) });
    assert.match(studyRoot.innerHTML, /范文学习/);
    assert.match(studyRoot.innerHTML, /data-essay-sentence/);
    assert.ok(
      splitEssayParagraphs(content.content).every((paragraph) =>
        splitChineseSentences(paragraph).every((sentence) =>
          studyRoot.innerHTML.includes(sentence),
        ),
      ),
    );
    const guidedRoot = fakeRoot();
    guidedEssayWriting(guidedRoot, { params: new URLSearchParams(`topic=${topic.id}`) });
    assert.match(guidedRoot.innerHTML, /完成后查看范文/);
    assert.match(guidedRoot.innerHTML, /id="guided-copy"/);
    assert.ok(!guidedRoot.innerHTML.includes(content.content));
    guidedRoot.listeners.click({
      target: { closest: () => ({ id: 'guided-reveal', dataset: {} }) },
    });
    assert.ok(
      splitEssayParagraphs(content.content).every((paragraph) =>
        splitChineseSentences(paragraph).every((sentence) =>
          guidedRoot.innerHTML.includes(sentence),
        ),
      ),
    );
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test('guided final hint renders its complete paragraph and retains the current student draft', () => {
  const previousStorage = globalThis.localStorage;
  const previousDrafts = state.drafts;
  globalThis.localStorage = { setItem() {} };
  const topic = titles.find((item) => item.gradeMin === 3);
  const content = contents.find((item) => item.essayId === topic.id);
  const training = deriveEssayTraining(content, topic);
  const key = `guided-essay:${content.contentId}`;
  state.drafts = {
    [key]: {
      text: '我的草稿。',
      lines: ['我的草稿。'],
      checklist: {},
      helpLevel: 1,
      reveal: false,
    },
  };
  const root = {
    innerHTML: '',
    listeners: {},
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    },
  };
  try {
    guidedEssayWriting(root, { params: new URLSearchParams(`topic=${topic.id}`) });
    for (let level = 1; level < 5; level += 1)
      root.listeners.click({
        target: { closest: () => ({ id: 'guided-more-help', dataset: {} }) },
      });
    assert.ok(root.innerHTML.includes(training.paragraphs[0].text));
    assert.ok(!root.innerHTML.includes(training.paragraphs[1].text));
    assert.equal(state.drafts[key].lines[0], '我的草稿。');
    assert.equal(state.drafts[key].helpLevel, 5);
  } finally {
    state.drafts = previousDrafts;
    globalThis.localStorage = previousStorage;
  }
});
