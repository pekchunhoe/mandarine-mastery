import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { distribution, titles, samples, newByGrade, modelFor, matching } from './essay-catalogue-fixtures.mjs';
import { splitEssayParagraphs } from '../js/essay-sentence-service.js';

// Defaults to the served production build. TEST_URL also supports dev/live diagnosis.
const base = process.env.TEST_URL || 'http://127.0.0.1:4183/';
const filterKeys = ['grade', 'category', 'theme', 'essayType', 'difficulty'];
const filter = (page, key) => page.locator(`[data-training-filter="${key}"]`);
let browser;
before(async () => { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) }); });
after(async () => browser?.close());

async function fixture(t, activity) {
  const context = await browser.newContext({ viewport: { width: 768, height: 1024 }, serviceWorkers: 'block' });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(`${base}#activity/${activity}`);
  await page.locator('#training-topic').waitFor();
  for (const key of filterKeys) await filter(page, key).selectOption('');
  await assertResults(page, titles);
  // Deliberately keep a different global Standard, lesson and 初级 setting.
  await page.evaluate(async () => {
    const { state, persist, vocabulary } = await import('/js/state.js');
    const lesson = vocabulary.find((word) => Number(word.grade) === 1 && word.lesson)?.lesson;
    if (!lesson) throw Error('Expected a real Standard 1 lesson for the global-filter regression');
    Object.assign(state.settings, { grade: '1', lesson, difficulty: 'easy' });
    persist();
  });
  await page.reload();
  await page.locator('#training-topic').waitFor();
  const settings = await page.evaluate(async () => (await import('/js/state.js')).state.settings);
  assert.equal(settings.grade, '1');
  assert.equal(settings.difficulty, 'easy');
  assert.notEqual(settings.lesson, 'all');
  for (const key of filterKeys) await filter(page, key).selectOption('');
  await assertResults(page, titles);
  return page;
}

async function assertResults(page, expected) {
  assert.equal(await page.locator('[data-training-topic-count]').textContent(), `${expected.length} 个有范文的题目`);
  const options = await page.locator('#training-topic option').evaluateAll((nodes) => nodes.map((node) => ({ id: node.value, label: node.textContent })));
  // A current essay outside the results is explicitly retained to protect writing.
  const retained = options.filter((option) => option.label.includes('筛选结果以外'));
  assert.ok(retained.length <= 1);
  assert.ok(retained.every((option) => !expected.some((title) => title.id === option.id)));
  const ids = options.filter((option) => option.id && !option.label.includes('筛选结果以外')).map((option) => option.id);
  assert.deepEqual(ids, expected.map((title) => title.id));
  assert.equal(new Set(ids).size, expected.length);
}

async function assertModel(page, activity, title) {
  if (activity === 'guidedEssay' && !(await page.locator('.comparison-grid').count())) await page.locator('#guided-reveal').click();
  const paragraphs = activity === 'modelEssay'
    ? page.locator('.model-reading .model-paragraph')
    : page.locator('.comparison-grid article').nth(1).locator('.model-paragraph');
  assert.deepEqual(await paragraphs.allTextContents(), splitEssayParagraphs(modelFor(title).content));
  const heading = page.locator(activity === 'modelEssay' ? '.model-study-heading' : '.guided-topic');
  assert.ok((await heading.textContent()).includes(title.essayType));
  assert.ok((await heading.textContent()).includes(`${['一', '二', '三', '四', '五', '六'][title.grade - 1]}年级`));
}

for (const activity of ['guidedEssay', 'modelEssay']) {
  test(`${activity}: 1,000 unique selectable IDs, six Standard totals, new Chinese searches and full models`, async (t) => {
    const page = await fixture(t, activity);
    for (const [grade, count] of Object.entries(distribution)) {
      await filter(page, 'grade').selectOption(grade);
      const expected = matching({ grade });
      assert.equal(expected.length, count);
      await assertResults(page, expected);
    }
    await filter(page, 'grade').selectOption('');
    for (const title of samples) {
      for (const search of [title.title, title.title.slice(-3)]) {
        await filter(page, 'search').fill(search);
        const expected = matching({ search });
        assert.ok(expected.some((item) => item.id === title.id));
        await assertResults(page, expected);
        await page.locator('#training-topic').selectOption(title.id);
        assert.equal(await page.locator('#training-topic').inputValue(), title.id);
        await assertModel(page, activity, title);
      }
      await filter(page, 'search').fill('');
      await assertResults(page, titles);
    }
    const title = newByGrade.at(-1), filters = {};
    for (const key of filterKeys) {
      filters[key] = String(title[key]);
      await filter(page, key).selectOption(filters[key]);
      await assertResults(page, matching(filters));
    }
    await filter(page, 'search').fill(title.title.slice(-3));
    await assertResults(page, matching({ ...filters, search: title.title.slice(-3) }));
    await page.locator('#training-topic').selectOption(title.id);
    await assertModel(page, activity, title);
    await filter(page, 'search').fill('');
    await assertResults(page, matching(filters));
    for (const key of filterKeys) await filter(page, key).selectOption('');
    await assertResults(page, titles);
  });

  test(`${activity}: continuous typing, IME, empty results and filters preserve selection and pupil drafts`, async (t) => {
    const page = await fixture(t, activity), title = newByGrade.at(-1);
    await page.locator('#training-topic').selectOption(title.id);
    const writing = '这是学生自己的原文，不能被搜索或年级筛选覆盖。';
    if (activity === 'guidedEssay') await page.locator('#guided-line').fill(writing);
    const search = filter(page, 'search');
    await search.evaluate((node) => { window.catalogueSearch = node; });
    const assertPreserved = async () => {
      assert.equal(await page.locator('#training-topic').inputValue(), title.id);
      if (activity === 'guidedEssay') assert.equal(await page.locator('#guided-line').inputValue(), writing);
    };
    await search.focus();
    let query = '';
    for (const character of '妈妈English') {
      query += character;
      await page.keyboard.insertText(character);
      assert.equal(await page.evaluate(() => document.activeElement === window.catalogueSearch && window.catalogueSearch.isConnected), true);
      await assertPreserved();
      await assertResults(page, matching({ search: query }));
    }
    await page.keyboard.press('Backspace');
    await assertResults(page, matching({ search: query.slice(0, -1) }));
    await search.fill('');
    await assertResults(page, titles);
    const ime = title.title.slice(0, 3);
    await search.evaluate((node, value) => {
      window.catalogueFirstOption = document.querySelector('#training-topic option');
      node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      node.value = value;
      node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    }, ime);
    await assertResults(page, titles);
    assert.equal(await page.evaluate(() => document.querySelector('#training-topic option') === window.catalogueFirstOption && document.activeElement === window.catalogueSearch), true);
    await search.evaluate((node, value) => {
      node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: value }));
      node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: false }));
    }, ime);
    await assertResults(page, matching({ search: ime }));
    await assertPreserved();
    await search.fill('这个题目确实不存在ABC');
    await assertResults(page, []);
    await assertPreserved();
    await search.fill('');
    await filter(page, 'grade').selectOption('1');
    await assertResults(page, matching({ grade: '1' }));
    await assertPreserved();
    await assertModel(page, activity, title);
    await filter(page, 'grade').selectOption('');
    await assertResults(page, titles);
    await page.reload();
    await page.locator('#training-topic').waitFor();
    await assertPreserved();
  });
}
