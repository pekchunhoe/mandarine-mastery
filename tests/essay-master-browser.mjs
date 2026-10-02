import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import titles from '../data/essay-titles.json' with { type: 'json' };
import contents from '../data/essay-contents.json' with { type: 'json' };
import { splitEssayParagraphs } from '../js/essay-sentence-service.js';
import { resultFor } from './tutor-fixtures.mjs';
const base = process.env.TEST_URL || 'http://localhost:4173/';
let browser;
before(async () => {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  await mkdir(new URL('../test-results/essays/', import.meta.url), { recursive: true });
});
after(async () => browser?.close());
async function fixture(t, route = 'guidedEssay', viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(`${base}#activity/${route}`);
  await page.locator('#training-topic, #writing-theme').waitFor();
  return page;
}
const sampleTitles = [...new Map([titles[0], titles[499], titles.at(-1), ...[1, 2, 3, 4, 5, 6].map((grade) => titles.find((title) => title.grade === grade)), ...[...new Set(titles.map((title) => title.essayType))].map((type) => titles.find((title) => title.essayType === type))].map((title) => [title.id, title])).values()];

test('all catalogue options, sample Standards and every genre resolve identical full essays in both activities', async (t) => {
  const page = await fixture(t, 'modelEssay');
  assert.equal(await page.locator('#training-topic option').count(), 1000);
  for (const title of sampleTitles) {
    const content = contents.find((item) => item.essayId === title.id);
    await page.locator('#training-topic').selectOption(title.id);
    assert.deepEqual(await page.locator('.model-reading .model-paragraph').allTextContents(), splitEssayParagraphs(content.content));
    assert.ok((await page.locator('.model-study-heading').textContent()).includes(title.essayType));
    await page.goto(`${base}#activity/guidedEssay?topic=${encodeURIComponent(title.id)}`);
    await page.locator('#guided-line').waitFor();
    assert.equal(await page.locator('#guided-line').inputValue(), '');
    assert.equal(await page.locator('.comparison-grid').count(), 0);
    await page.locator('#guided-reveal').click();
    assert.deepEqual(await page.locator('.comparison-grid article').nth(1).locator('.model-paragraph').allTextContents(), splitEssayParagraphs(content.content));
    await page.goto(`${base}#activity/modelEssay`);
    await page.locator('#training-topic').waitFor();
  }
});

test('search, combined filters, IME and typing retain selected title, focus, original drafts and resume', async (t) => {
  const page = await fixture(t);
  await page.locator('[data-training-filter="grade"]').selectOption('');
  const first = titles[0], last = titles.at(-1), writing = '这是我自己的原文，不能被范文或筛选覆盖。';
  await page.locator('#training-topic').selectOption(first.id);
  await page.locator('#guided-line').fill(writing);
  const search = page.locator('[data-training-filter="search"]');
  await search.evaluate((node) => { window.testSearch = node; });
  await search.focus();
  for (const character of '妈妈English') {
    await page.keyboard.insertText(character);
    assert.equal(await page.evaluate(() => document.activeElement === window.testSearch && window.testSearch.isConnected), true);
    assert.equal(await page.locator('#guided-line').inputValue(), writing);
    assert.equal(await page.locator('#training-topic').inputValue(), first.id);
  }
  await page.keyboard.press('Backspace');
  await search.fill('');
  await search.evaluate((node) => {
    node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    node.value = '妈';
    node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '妈' }));
    node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: false }));
  });
  assert.equal(await page.evaluate(() => document.querySelector('[data-training-filter="search"]') === window.testSearch), true);
  await search.fill('');
  await page.locator('[data-training-filter="grade"]').selectOption(String(last.grade));
  await page.locator('[data-training-filter="essayType"]').selectOption(last.essayType);
  await page.locator('[data-training-filter="category"]').selectOption(last.category);
  await page.locator('[data-training-filter="theme"]').selectOption(last.theme);
  const expected = titles.filter((title) => title.grade === last.grade && title.essayType === last.essayType && title.category === last.category && title.theme === last.theme);
  const options = await page.locator('#training-topic option').evaluateAll((nodes) => nodes.map((node) => node.value).filter(Boolean));
  assert.deepEqual(options.filter((id) => id !== first.id), expected.map((title) => title.id));
  assert.equal(await page.locator('#training-topic').inputValue(), first.id);
  assert.equal(await page.locator('#guided-line').inputValue(), writing);
  await page.locator('#training-topic').selectOption(last.id);
  await page.locator('#guided-line').fill('另一篇作文的独立草稿。');
  await page.reload();
  await page.locator('#guided-line').waitFor();
  assert.equal(await page.locator('#training-topic').inputValue(), last.id);
  assert.equal(await page.locator('#guided-line').inputValue(), '另一篇作文的独立草稿。');
  await page.locator('[data-training-filter="grade"]').selectOption('');
  await page.locator('#training-topic').selectOption(first.id);
  assert.equal(await page.locator('#guided-line').inputValue(), writing);
  await page.evaluate(() => { navigator.clipboard.writeText = async (text) => { window.testCopied = text; }; });
  await page.locator('#guided-copy').click();
  assert.equal(await page.evaluate(() => window.testCopied), writing);
});

test('revised model paragraph counts retain all pupil paragraphs and actual Standard/genre reaches direct and copied prompts', async (t) => {
  const page = await fixture(t), topic = titles.find((title) => title.essayType === '演讲稿');
  const content = contents.find((item) => item.essayId === topic.id);
  const lines = Array.from({ length: 8 }, (_, index) => `这是学生第${index + 1}段的原文。`);
  await page.evaluate(async ({ content, topic, lines }) => {
    const { state, persist } = await import('/js/state.js');
    state.drafts[`guided-essay:${content.contentId}`] = { text: lines.join('\n\n'), lines, title: topic.title, contentId: content.contentId, kind: 'essay' };
    state.essaySelections = { guidedEssay: topic.id };
    persist();
  }, { content, topic, lines });
  await page.reload();
  await page.locator('#guided-line').waitFor();
  assert.equal(await page.locator('[data-guided-paragraph]').count(), 8);
  await page.locator('[data-guided-paragraph="7"]').click();
  assert.equal(await page.locator('#guided-line').inputValue(), lines[7]);
  assert.equal(await page.locator('#guided-preview').textContent(), lines.join('\n\n'));
  assert.ok(!(await page.locator('.self-assess').textContent()).includes('事情有开始'));
  let input;
  await page.route('**/api/gemini', async (route) => {
    input = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, action: input.action, data: resultFor(input.action, input.context) } });
  });
  await page.locator('[data-ai-action="paragraph_expand"]').click();
  await page.locator('#modal .ai-result[aria-busy="false"] h3').first().waitFor();
  assert.equal(input.context.selectedTitle, topic.title);
  assert.equal(input.context.essayGrade, topic.grade);
  assert.equal(input.context.essayType, topic.essayType);
  assert.equal(input.context.studentParagraph, lines[7]);
  assert.equal(input.context.previousStudentParagraph, lines[6]);
  assert.ok(!JSON.stringify(input).includes(content.content));
  await page.locator('#modal [data-close-modal]').click();
  await page.evaluate(() => { navigator.clipboard.writeText = async (text) => { window.testCopied = text; }; });
  await page.locator('[data-external-ai-launcher]').click();
  await page.locator('[data-external-ai-menu] [data-external-ai-action="paragraph_expand"]').click();
  const copied = await page.evaluate(() => window.testCopied);
  assert.ok(copied.includes(`Standard ${topic.grade}`) && copied.includes(topic.essayType) && copied.includes(lines[7]));
  assert.equal(await page.locator('#guided-line').inputValue(), lines[7]);
});

test('writing catalogue uses stable IDs, keeps search input and isolates legacy drafts between activities', async (t) => {
  const page = await fixture(t, 'essay'), title = titles.find((item) => item.grade === 3);
  await page.evaluate(async (topic) => {
    const { state, persist } = await import('/js/state.js');
    state.drafts['composition:3:all:0'] = { title: topic.title, text: '旧作文原文，必须保留。', kind: 'essay' };
    persist();
  }, title);
  await page.goto(`${base}#activity/essay?topic=${title.id}`);
  await page.reload();
  await page.locator('#essay-text').waitFor();
  assert.equal(await page.locator('#essay-text').inputValue(), '旧作文原文，必须保留。');
  await page.locator('#essay-text').fill('新作文草稿，独立保存。');
  const search = page.locator('#essay-topic-search');
  await search.evaluate((node) => { window.testSearch = node; });
  await search.focus();
  for (const character of '华文abc') {
    await page.keyboard.insertText(character);
    assert.equal(await page.evaluate(() => document.activeElement === window.testSearch && window.testSearch.isConnected), true);
  }
  await search.fill('');
  await page.locator('#essay-topic-grade').selectOption('6');
  assert.equal(await page.locator('#writing-theme').inputValue(), title.id);
  assert.equal(await page.locator('#essay-text').inputValue(), '新作文草稿，独立保存。');
  await page.goto(`${base}#activity/planner?topic=${title.id}`);
  await page.locator('#essay-text').waitFor();
  assert.equal(await page.locator('#essay-text').inputValue(), '旧作文原文，必须保留。');
  await page.locator('#essay-text').fill('计划活动的独立原文。');
  await page.goto(`${base}#activity/essay?topic=${title.id}`);
  await page.locator('#essay-text').waitFor();
  assert.equal(await page.locator('#essay-text').inputValue(), '新作文草稿，独立保存。');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('huawen-lab-v1')).drafts['composition:3:all:0'].text), '旧作文原文，必须保留。');
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
  test(`new catalogue fits ${viewport.width}x${viewport.height} in both activities`, async (t) => {
    const page = await fixture(t, 'guidedEssay', viewport);
    for (const route of ['guidedEssay', 'modelEssay']) {
      await page.goto(`${base}#activity/${route}`);
      await page.locator('#training-topic').waitFor();
      await page.locator('[data-training-filter="grade"]').selectOption('');
      assert.equal(await page.locator('[data-training-filter="grade"]').count(), 1);
      assert.equal(await page.locator('#training-topic option').count(), 1000);
      const bounds = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(bounds.scroll <= bounds.width + 1, JSON.stringify(bounds));
      await page.screenshot({ path: `test-results/essays/${route}-${viewport.width}.png`, fullPage: true });
    }
  });
}
