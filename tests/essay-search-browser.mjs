import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { matching, titles, newByGrade, modelFor } from './essay-catalogue-fixtures.mjs';
import { splitEssayParagraphs } from '../js/essay-sentence-service.js';

const base = process.env.TEST_URL || 'http://127.0.0.1:4183/';
const searchFor = (page) => page.locator('[data-training-filter="search"]');
let browser;
before(async () => {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  await mkdir(new URL('../test-results/essay-search/', import.meta.url), { recursive: true });
});
after(async () => browser?.close());
async function fixture(t, activity, viewport = { width: 768, height: 1024 }, englishFixture = false) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  t.after(() => context.close());
  if (englishFixture) await context.route('**/data/essay-titles.json', (route) => route.fulfill({ json: titles.map((title, index) => index ? title : { ...title, suggestedKeywords: [...title.suggestedKeywords, 'SchoolCampus'] }) }));
  await context.addInitScript(() => {
    window.searchUpdates = 0;
    const replace = Element.prototype.replaceChildren;
    Element.prototype.replaceChildren = function (...nodes) {
      if (this.id === 'training-topic') window.searchUpdates++;
      return replace.apply(this, nodes);
    };
    window.speechCalls = [];
    window.speechCancels = 0;
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; } } });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => [{ name: 'Mandarin', lang: 'zh-CN' }], addEventListener() {}, speak(utterance) { window.speechCalls.push(utterance); }, cancel() { window.speechCancels++; }, pause() {}, resume() {} } });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(`${base}#activity/${activity}`);
  await page.locator('#training-topic').waitFor();
  await page.locator('[data-training-filter="grade"]').selectOption('');
  await results(page, '');
  return page;
}
async function results(page, search, filters = {}, expected = matching({ ...filters, search })) {
  assert.equal(await page.locator('[data-training-topic-count]').textContent(), `${expected.length} 个有范文的题目`);
  const ids = await page.locator('#training-topic option').evaluateAll((nodes) => nodes.filter((node) => node.value && !node.textContent.includes('筛选结果以外')).map((node) => node.value));
  assert.deepEqual(ids, expected.map((title) => title.id));
}
async function expectUpdates(page, count, action) {
  const before = await page.evaluate(() => window.searchUpdates);
  await action();
  assert.equal(await page.evaluate(() => window.searchUpdates), before + count);
}
async function retainInput(page) {
  await searchFor(page).evaluate((node) => { window.originalSearch = node; });
  await searchFor(page).click();
}
async function focused(page) {
  assert.equal(await page.evaluate(() => document.querySelector('[data-training-filter="search"]') === window.originalSearch && document.activeElement === window.originalSearch && window.originalSearch.isConnected), true);
}

for (const activity of ['guidedEssay', 'modelEssay']) {
  test(`${activity}: committed IME query filters on compositionend without a later input`, async (t) => {
    const page = await fixture(t, activity);
    await retainInput(page);
    await searchFor(page).evaluate((node) => {
      node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      node.value = '难忘';
      node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    });
    await results(page, '');
    await focused(page);
    await searchFor(page).dispatchEvent('compositionend', { data: '难忘' });
    await results(page, '难忘');
    await focused(page);
  });

  test(`${activity}: IME lifecycle defers partial text and commits once with a trailing input`, async (t) => {
    const page = await fixture(t, activity);
    await retainInput(page);
    await expectUpdates(page, 0, () => searchFor(page).evaluate((node) => {
      node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      node.value = 'xue';
      // Even an input event without isComposing must respect the active lifecycle.
      node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: false }));
    }));
    await results(page, '');
    await focused(page);
    await expectUpdates(page, 1, () => searchFor(page).evaluate((node) => {
      node.value = '学校';
      node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '学校' }));
      node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: false }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    }));
    await results(page, '学校');
    await focused(page);
  });

  test(`${activity}: one click, continuous Chinese typing, caret edits and clear preserve the input`, async (t) => {
    const page = await fixture(t, activity);
    await retainInput(page);
    let query = '';
    for (const character of '一次难忘的经历') {
      query += character;
      await expectUpdates(page, 1, () => page.keyboard.insertText(character));
      assert.equal(await searchFor(page).inputValue(), query);
      await focused(page);
      await results(page, query);
    }
    await page.keyboard.press('Backspace');
    query = query.slice(0, -1);
    await results(page, query);
    await page.keyboard.press('Home');
    await page.keyboard.press('Delete');
    query = query.slice(1);
    assert.equal(await searchFor(page).inputValue(), query);
    await focused(page);
    await results(page, query);
    await page.keyboard.press('Control+A');
    assert.deepEqual(await searchFor(page).evaluate((node) => [node.selectionStart, node.selectionEnd]), [0, query.length]);
    await page.keyboard.insertText('  难忘  ');
    await results(page, '难忘');
    assert.equal(await searchFor(page).inputValue(), '  难忘  ');
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('不存在的题目XYZ');
    await results(page, '不存在的题目XYZ');
    assert.equal(await page.locator('[data-training-empty]').isVisible(), true);
    await focused(page);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await results(page, '');
    assert.equal(await page.locator('[data-training-empty]').isVisible(), false);
    await focused(page);
    await searchFor(page).fill('不存在的题目XYZ');
    await page.locator('[data-training-filter="grade"]').selectOption('3');
    assert.equal(await searchFor(page).inputValue(), '不存在的题目XYZ');
    await results(page, '不存在的题目XYZ', { grade: '3' });
    assert.equal(await page.locator('[data-training-empty]').isVisible(), true);
    await searchFor(page).fill('');
    await results(page, '', { grade: '3' });
  });

  test(`${activity}: search and combined filters retain state, paragraphs, mapping and autosave`, async (t) => {
    const page = await fixture(t, activity), title = newByGrade[4];
    const filters = {}, query = title.title.slice(-3);
    const initialId = await page.locator('#training-topic').inputValue();
    const draft = '第一句是我的原文。\n第二句仍是自己的想法。';
    if (activity === 'guidedEssay') {
      await page.locator('[data-guided-paragraph="1"]').click();
      await page.locator('#guided-line').fill(draft);
    } else await page.locator('[data-model-paragraph="1"]').click();
    await retainInput(page);
    await searchFor(page).fill(query);
    await focused(page);
    for (const key of ['grade', 'category', 'theme', 'essayType', 'difficulty']) {
      filters[key] = String(title[key]);
      await page.locator(`[data-training-filter="${key}"]`).selectOption(filters[key]);
      assert.equal(await searchFor(page).inputValue(), query);
      await results(page, query, filters);
      assert.equal(await page.locator('#training-topic').inputValue(), initialId);
      if (activity === 'guidedEssay') {
        assert.equal(await page.locator('#guided-line').inputValue(), draft);
        assert.equal(await page.locator('[data-guided-paragraph="1"]').getAttribute('aria-current'), 'step');
      }
    }
    if (activity === 'guidedEssay') {
      await page.waitForFunction(({ id, draft }) => Object.values(JSON.parse(localStorage.getItem('huawen-lab-v1')).drafts).some((item) => item.essayId === id && item.lines?.[1] === draft), { id: initialId, draft });
    }
    await page.locator('#training-topic').selectOption(title.id);
    assert.equal(await searchFor(page).inputValue(), query);
    await results(page, query, filters);
    if (activity === 'guidedEssay') {
      assert.equal(await page.locator('#guided-line').inputValue(), '');
      await page.locator('#guided-reveal').click();
    }
    const paragraphs = activity === 'guidedEssay' ? page.locator('.comparison-grid article').nth(1).locator('.model-paragraph') : page.locator('.model-reading .model-paragraph');
    assert.deepEqual(await paragraphs.allTextContents(), splitEssayParagraphs(modelFor(title).content));
    // A legitimate redraw of a paragraph/help section must keep the query.
    await page.locator(activity === 'guidedEssay' ? '[data-guided-paragraph="1"]' : '[data-model-paragraph="1"]').click();
    assert.equal(await searchFor(page).inputValue(), query);
    await results(page, query, filters);
    await searchFor(page).fill('');
    await results(page, '', filters);
    for (const key of Object.keys(filters)) await page.locator(`[data-training-filter="${key}"]`).selectOption('');
    await results(page, '');
    if (activity === 'guidedEssay') {
      await page.locator('#training-topic').selectOption(initialId);
      await page.locator('[data-guided-paragraph="1"]').click();
      assert.equal(await page.locator('#guided-line').inputValue(), draft);
    }
  });

  test(`${activity}: English metadata remains partial and case-insensitive`, async (t) => {
    // Current source metadata is Chinese. Inject only this test response to exercise English support.
    const page = await fixture(t, activity, undefined, true);
    await searchFor(page).fill('  cAmPuS  ');
    await results(page, 'campus', {}, [titles[0]]);
    await searchFor(page).fill('');
    await results(page, '');
  });

  test(`${activity}: repeated navigation and redraw do not multiply search handlers`, async (t) => {
    const page = await fixture(t, activity);
    for (let index = 0; index < 3; index++) {
      await page.goto(`${base}#activities`);
      await page.waitForFunction(() => !document.querySelector('[data-training-filter="search"]'));
      await page.goBack();
      await searchFor(page).waitFor();
      await retainInput(page);
      const query = index % 2 ? '学校' : '难忘';
      await expectUpdates(page, 1, () => searchFor(page).fill(query));
      await results(page, query);
      await focused(page);
      // This invokes an unrelated activity draw without re-registering listeners.
      await page.locator(activity === 'guidedEssay' ? '[data-guided-paragraph="1"]' : '[data-model-paragraph="1"]').click();
      assert.equal(await searchFor(page).inputValue(), query);
      await expectUpdates(page, 1, () => searchFor(page).fill(''));
      await results(page, '');
    }
    // A new route instance followed by full disposal/reset must also have one handler.
    await page.goto(`${base}#activity/${activity}?topic=${newByGrade[2].id}`);
    await page.waitForFunction((id) => document.querySelector('#training-topic')?.value === id, newByGrade[2].id);
    await searchFor(page).evaluate((node) => { window.disposedSearch = node; });
    await page.locator('#reset-activity').click();
    await page.locator('#accept-confirm').click();
    await expectUpdates(page, 0, () => page.evaluate(() => {
      window.disposedSearch.value = '已经销毁的搜索';
      window.disposedSearch.dispatchEvent(new InputEvent('input', { bubbles: true }));
      window.disposedSearch.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    }));
    await page.locator('[data-training-filter="grade"]').selectOption('');
    await expectUpdates(page, 1, () => searchFor(page).fill('学校'));
    await results(page, '学校');
  });
}

test('modelEssay: searching and blurring leave reading, highlights and selected paragraph intact', async (t) => {
  const page = await fixture(t, 'modelEssay');
  await page.locator('[data-model-paragraph="1"]').click();
  await page.locator('.model-reading [data-speak-essay]').click();
  await page.waitForFunction(() => window.speechCalls.length > 0);
  await page.evaluate(() => window.speechCalls[0].onstart?.({}));
  const before = await page.evaluate(() => ({ cancels: window.speechCancels, selected: document.querySelector('#training-topic').value, paragraph: document.querySelector('[data-model-paragraph][aria-pressed="true"]').dataset.modelParagraph }));
  await page.locator('.model-reading').evaluate((node) => { window.originalReader = node; });
  await retainInput(page);
  await searchFor(page).fill('难忘');
  await results(page, '难忘');
  await searchFor(page).blur();
  assert.equal(await page.evaluate(() => window.speechCancels), before.cancels);
  assert.equal(await page.evaluate(() => document.querySelector('.model-reading') === window.originalReader), true);
  assert.equal(await page.locator('#training-topic').inputValue(), before.selected);
  assert.equal(await page.locator('[data-model-paragraph][aria-pressed="true"]').getAttribute('data-model-paragraph'), before.paragraph);
  assert.equal(await page.locator('.essay-sentence--active').count(), 1);
});

for (const viewport of [
  { width: 320, height: 740 }, { width: 360, height: 800 }, { width: 375, height: 812 },
  { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 430, height: 932 },
  { width: 844, height: 390 }, { width: 768, height: 1024 }, { width: 1024, height: 768 },
  { width: 1440, height: 900 },
]) {
  test(`both search catalogues fit and filter at ${viewport.width}×${viewport.height}`, async (t) => {
    const page = await fixture(t, 'guidedEssay', viewport);
    for (const activity of ['guidedEssay', 'modelEssay']) {
      await page.goto(`${base}#activity/${activity}`);
      await page.locator('#training-topic').waitFor();
      await page.locator('[data-training-filter="grade"]').selectOption('');
      await retainInput(page);
      for (const character of '学校') {
        await page.keyboard.insertText(character);
        await focused(page);
        await results(page, await searchFor(page).inputValue());
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      const box = await searchFor(page).boundingBox();
      assert.ok(box.width > 150 && box.height >= 40 && box.x >= 0 && box.x + box.width <= viewport.width);
      if ([320, 768].includes(viewport.width)) await page.locator('.training-picker').screenshot({ path: `test-results/essay-search/${activity}-${viewport.width}.png` });
    }
  });
}
