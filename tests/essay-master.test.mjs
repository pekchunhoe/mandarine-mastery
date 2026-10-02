import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { auditEssayCatalogue, masterWorkbook, normalizeRows, normalizeContentRows, readEssayWorkbookData } from '../tools/essay-title-import.mjs';
import titles from '../data/essay-titles.json' with { type: 'json' };
import contents from '../data/essay-contents.json' with { type: 'json' };
import { getEssayTitleById, getEssayTitles } from '../js/essay-title-service.js';
import { getPrimaryEssayContent } from '../js/essay-content-service.js';
import { deriveEssayTraining } from '../js/essay-training-service.js';
import { resolveWritingDraft } from '../js/essay-draft-service.js';
import { hydrate, freshState } from '../js/storage.js';
import { tutorRequest, TUTOR_ACTION as A, TUTOR_ACTIVITY as B } from '../js/tutor-actions.js';
import { buildGuidedExternalAiPrompt } from '../activities/essayTraining.js';

const distribution = { 1: 100, 2: 140, 3: 180, 4: 190, 5: 190, 6: 200 };
test('all 1,000 imported records and every text match the authoritative workbook', async () => {
  const source = await readEssayWorkbookData(masterWorkbook);
  assert.deepEqual(titles, normalizeRows(source.titleRows).records);
  assert.deepEqual(contents, normalizeContentRows(source.contentRows, new Set(titles.map((title) => title.id))).records);
  assert.deepEqual(auditEssayCatalogue(titles, contents, { expectedDistribution: distribution }).distribution, distribution);
  const sourceById = new Map(source.contentRows.map(({ raw }) => [raw.content_id, raw]));
  for (const { raw } of source.titleRows) assert.equal(getEssayTitleById(raw.id).id, raw.id);
  for (const content of contents) {
    const raw = sourceById.get(content.contentId);
    assert.equal(content.essayId, raw.essay_id);
    assert.equal(content.content, raw.content.replace(/\r\n?/g, '\n'));
    assert.equal(content.wordCount, Number(raw.word_count));
    assert.equal(Number(content.level), getEssayTitleById(content.essayId).gradeMin);
    assert.equal(content.contentTitle, getEssayTitleById(content.essayId).title);
    assert.equal(getPrimaryEssayContent(content.essayId), content);
  }
  assert.equal(titles.filter((title) => title.writingGuidance.length === 0).length, 700);
  assert.equal(titles.filter((title) => title.suggestedKeywords.length === 0).length, 700);
  assert.equal(contents.filter((content) => content.wordCount !== content.hanCharacterCount).length, 1);
});

test('catalogue validation rejects missing models, orphans, wrong Standards and duplicate active models', () => {
  for (const invalid of [contents.slice(1), [...contents, { ...contents[0], contentId: 'extra' }], [{ ...contents[0], essayId: 'unknown' }, ...contents.slice(1)], [{ ...contents[0], level: '6' }, ...contents.slice(1)]])
    assert.throws(() => auditEssayCatalogue(titles, invalid), /validation failed/);
});

test('individual and combined filters preserve stable IDs and source sort order for every genre', () => {
  for (const title of [titles[0], titles[499], titles.at(-1), ...Array.from(new Set(titles.map((title) => title.essayType)), (type) => titles.find((title) => title.essayType === type))]) {
    assert.ok(getEssayTitles({ grade: title.gradeMin, category: title.category, theme: title.theme, essayType: title.essayType, difficulty: title.difficulty }).some((item) => item.id === title.id));
  }
  for (const [grade, count] of Object.entries(distribution)) assert.equal(getEssayTitles({ grade }).length, count);
  assert.equal(getEssayTitles().length, 1000);
  assert.deepEqual(getEssayTitles().map((title) => title.id), titles.map((title) => title.id));
});

test('legacy drafts migrate by saved identity without mutating originals, collisions or unmatched work', () => {
  const topic = titles[0], legacyKey = 'composition:3:all:0';
  const drafts = { [legacyKey]: { title: topic.title, text: '学生原文。\n\n不能删除。', plan: { who: '我的妈妈' } }, unmatched: { title: '旧自选题目', text: '保留原文' } };
  const before = structuredClone(drafts);
  const options = { grade: '3', lesson: 'all', topic };
  const essay = resolveWritingDraft(drafts, { ...options, activityId: 'essay' });
  assert.deepEqual(drafts, before);
  assert.equal(essay.draft.text, before[legacyKey].text);
  drafts[essay.key] = essay.draft;
  assert.equal(resolveWritingDraft(drafts, { ...options, activityId: 'essay' }).draft, essay.draft);
  assert.notEqual(resolveWritingDraft(drafts, { ...options, activityId: 'planner' }).key, essay.key);
  assert.notEqual(resolveWritingDraft(drafts, { ...options, activityId: 'assistant' }).key, essay.key);
  assert.equal(drafts.unmatched.text, '保留原文');
  const hydrated = hydrate({ ...freshState(), drafts, essaySelections: { essay: topic.id } });
  assert.equal(hydrated.drafts[legacyKey].text, before[legacyKey].text);
  assert.equal(hydrated.essaySelections.essay, topic.id);
});

test('non-narrative genres use labelled local scaffolding and correct metadata in both AI routes', () => {
  for (const essayType of ['应用文', '演讲稿', '日记', '观察日记', '说明文', '状物作文', '写景作文', '议论文']) {
    const topic = titles.find((title) => title.essayType === essayType);
    const training = deriveEssayTraining(getPrimaryEssayContent(topic.id), topic);
    assert.match(training.scaffoldSource, /本地/);
    assert.ok(training.paragraphs.every((paragraph) => /^第\d+段$/.test(paragraph.label)));
    assert.ok(!training.writingQuestions.join('').includes('事情怎样开始'));
    const request = tutorRequest(A.PARAGRAPH_EXPAND, B.ESSAY, { selectedTitle: topic.title, essayGrade: topic.gradeMin, essayType, studentParagraph: '这是我自己的想法和原文。', EssayContents: '不得提交范文' });
    assert.equal(request.context.essayGrade, topic.gradeMin);
    assert.equal(request.context.essayType, essayType);
    assert.ok(!('EssayContents' in request.context));
    const external = buildGuidedExternalAiPrompt(A.PARAGRAPH_EXPAND, request.context);
    assert.ok(external.includes(`Standard ${topic.gradeMin}`));
    assert.ok(external.includes(essayType));
    assert.ok(external.includes('这是我自己的想法和原文。'));
  }
});
