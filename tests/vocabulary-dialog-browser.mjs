import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createVocabularyService } from '../js/vocabulary-service.js';

const base = process.env.TEST_URL || 'http://localhost:4173/';
const source = JSON.parse(await readFile(new URL('../data/vocabulary.json', import.meta.url), 'utf8'));
const service = createVocabularyService(source);
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined), headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
await context.addInitScript(() => {
  window.__spoken = [];
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  Object.defineProperty(window, 'speechSynthesis', { value: {
    getVoices: () => [{ name: 'Cantonese', lang: 'zh-HK' }, { name: 'Mandarin', lang: 'zh-CN' }],
    speak: (u) => window.__spoken.push({ text: u.text, lang: u.lang, voice: u.voice?.lang }),
    cancel() {}, pause() {}, resume() {}, addEventListener() {},
  } });
});
const page = await context.newPage();
const results = [], errors = [];
page.on('pageerror', (error) => errors.push(error.message));
async function check(name, fn) { await fn(); results.push(name); console.log('PASS ' + name); }
async function go(route) { await page.goto(base + '#' + route); await page.locator('#main').waitFor(); }
const dialog = page.locator('#modal');
const close = () => dialog.getByRole('button', { name: '关闭词语库', exact: true }).click();
async function search(query, word) {
  await page.locator('#lookup-search').fill(query);
  const expected = service.searchWords(query).slice(0, 18).map((w) => w.id);
  await expect(page.locator('[data-lookup-word]')).toHaveCount(expected.length);
  assert.deepEqual(await page.locator('[data-lookup-word]').evaluateAll((nodes) => nodes.map((n) => n.dataset.lookupWord)), expected);
  if (word) await expect(page.locator('[data-lookup-word] h3').filter({ hasText: new RegExp(`^${word}$`) }).first()).toBeVisible();
}
try {
  await check('Runtime and production data are identical, with both new fields on every record', async () => {
    const runtime = await (await page.request.get(base + 'data/vocabulary.json')).json();
    assert.deepEqual(runtime, source);
    assert.deepEqual(JSON.parse(await readFile(new URL('../dist/data/vocabulary.json', import.meta.url), 'utf8')), source);
    for (const w of runtime) { assert.equal(typeof w.generatedSynonyms, 'string'); assert.equal(typeof w.definitionChinese, 'string'); }
  });
  await check('Main library uses ranked word, synonym, definition and pinyin search and shared details', async () => {
    await go('library');
    await page.locator('[data-setting="grade"]').selectOption('mixed');
    const pinyinWord = source.find((w) => w.pinyin);
    for (const q of ['巨大', '庞大', ' 宏大 ', '硕大', '石头', '非常大', ...(pinyinWord ? [pinyinWord.pinyin.toUpperCase()] : [])]) {
      await page.locator('#word-search').fill(q);
      const expected = service.searchWords(q).slice(0, 18).map((w) => w.id);
      assert.deepEqual(await page.locator('#word-grid [data-word-card]').evaluateAll((nodes) => nodes.map((n) => n.dataset.wordCard)), expected);
    }
    await page.locator('#word-search').fill('巨大');
    const card = page.locator('.word-card').first();
    const huge = source.find((w) => w.word === '巨大');
    for (const field of ['generatedSynonyms', 'definitionChinese', 'exampleSentence']) await expect(card).toContainText(huge[field]);
    await card.locator('[data-speak]').click();
    assert.deepEqual(await page.evaluate(() => window.__spoken.at(-1)), { text: '巨大', lang: 'zh-CN', voice: 'zh-CN' });
    await card.locator('[data-word-card]').click();
    await expect(dialog).toContainText(huge.definitionChinese);
    await page.keyboard.press('Escape');
  });
  let baseline, essayNode, route;
  const draft = '词库浮窗验证：我写下了独一无二的故事，草稿必须原样保留。';
  const snapshot = () => page.evaluate(() => ({
    topic: document.querySelector('#training-topic').value,
    step: document.querySelector('[data-guided-paragraph][aria-current="step"]').textContent,
    points: document.querySelector('.guided-help').textContent,
    instructions: document.querySelector('.guided-think').textContent,
    text: document.querySelector('#guided-line').value,
    selection: [document.querySelector('#guided-line').selectionStart, document.querySelector('#guided-line').selectionEnd],
    checked: document.querySelector('#guided-check-0').checked,
    hash: location.hash,
  }));
  await check('Guided essay opens an accessible in-place lookup and preserves draft, step, key points and selection', async () => {
    await go('activity/guidedEssay');
    await page.locator('[data-guided-paragraph="1"]').click();
    await page.locator('#guided-more-help').click();
    await page.locator('#guided-more-help').click();
    await page.locator('#guided-check-0').check();
    await page.locator('#guided-line').fill(draft);
    await page.locator('#guided-line').evaluate((el) => el.setSelectionRange(3, 8));
    baseline = await snapshot(); route = page.url();
    essayNode = await page.locator('#guided-line').elementHandle();
    await page.locator('#guided-vocabulary').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: '词语库', exact: true })).toBeVisible();
    await expect(page.locator('#lookup-search')).toBeFocused();
    assert.equal(page.url(), route);
    assert.equal(await essayNode.evaluate((el) => el === document.querySelector('#guided-line')), true);
    for (const [query, word] of [['巨大', '巨大'], ['庞大', '巨大'], ['宏大', '巨大'], ['石头', '巨石']]) await search(query, word);
    await search('巨大', '巨大');
    const huge = source.find((w) => w.word === '巨大');
    const result = page.locator(`[data-lookup-word="${huge.id}"]`);
    for (const field of ['generatedSynonyms', 'definitionChinese', 'exampleSentence']) await expect(result).toContainText(huge[field]);
    const before = await page.evaluate(() => window.__spoken.length);
    await result.locator('[data-speak]').click();
    assert.equal(await page.evaluate(() => window.__spoken.length), before + 1);
    assert.deepEqual(await page.evaluate(() => window.__spoken.at(-1)), { text: huge.word, lang: 'zh-CN', voice: 'zh-CN' });
    await close();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('#guided-vocabulary')).toBeFocused();
    assert.deepEqual(await snapshot(), baseline);
  });
  await check('Repeated opening, blank/rapid/cleared/no-result queries and keyboard closing leave no stale UI or handlers', async () => {
    for (let i = 0; i < 3; i++) {
      await page.locator('#guided-vocabulary').click();
      await expect(page.locator('#lookup-search')).toHaveValue('');
      assert.equal(await page.getByRole('dialog').count(), 1);
      assert.equal(await page.locator('#lookup-results').count(), 1);
      if (i < 2) {
        for (const q of [' ', '庞', '庞大', '庞大、宏大', 'zzzz-no-results', '']) await search(q);
        await search('巨大');
        const before = await page.evaluate(() => window.__spoken.length);
        await page.locator('#lookup-results [data-speak]').first().click();
        assert.equal(await page.evaluate(() => window.__spoken.length), before + 1);
        await search('zzzz-no-results');
        await expect(page.locator('#lookup-results')).toContainText('找不到相关词语');
      }
      await page.locator('#lookup-search').focus();
      await page.keyboard.press('Shift+Tab');
      await expect(dialog.locator('[data-close-modal]')).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true);
      if (i === 1) { await dialog.locator('[data-close-modal]').focus(); await page.keyboard.press('Enter'); }
      else await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(page.locator('#guided-vocabulary')).toBeFocused();
      await expect(page.locator('#lookup-results')).toHaveCount(0);
      assert.deepEqual(await snapshot(), baseline);
    }
  });
  await check('Phone, tablet and desktop panels fit, scroll internally and preserve essay state', async () => {
    for (const [width, height] of [[320, 740], [375, 812], [390, 844], [430, 932], [768, 1024], [1024, 768], [1366, 900], [390, 420]]) {
      await page.setViewportSize({ width, height });
      await page.locator('#guided-vocabulary').tap();
      await expect(page.locator('#lookup-search')).toBeVisible();
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1, JSON.stringify({ width, bounds }));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
      const closeBounds = await dialog.locator('[data-close-modal]').boundingBox();
      assert.ok(closeBounds.width >= 44 && closeBounds.height >= 44);
      const results = page.locator('.vocabulary-dialog-results');
      assert.ok(await results.evaluate((el) => el.scrollHeight > el.clientHeight));
      await results.evaluate((el) => { el.scrollTop = 300; });
      assert.ok(await results.evaluate((el) => el.scrollTop > 0));
      await search('庞大', '巨大');
      await page.screenshot({ path: fileURLToPath(new URL(`../test-results/lookup-${width}-${height}.png`, import.meta.url)) });
      await dialog.locator('[data-close-modal]').tap();
      await expect(dialog).not.toBeVisible();
      assert.deepEqual(await snapshot(), baseline);
    }
  });
  await check('Draft autosave, refresh recovery and browser Back remain functional after lookup', async () => {
    await expect.poll(async () => page.evaluate((text) => Object.values(JSON.parse(localStorage.getItem('huawen-lab-v1')).drafts).some((d) => d.lines?.includes(text)), draft)).toBe(true);
    await page.reload();
    await page.locator('[data-guided-paragraph="1"]').click();
    await expect(page.locator('#guided-line')).toHaveValue(draft);
    await page.locator('#guided-vocabulary').click(); await close();
    await page.locator('.bottom-nav a[href="#library"]').click();
    await page.locator('#word-search').waitFor();
    await page.goBack();
    await page.locator('[data-guided-paragraph="1"]').click();
    await expect(page.locator('#guided-line')).toHaveValue(draft);
  });
  await check('Storage-denial fallback preserves guided drafts across lookup', async () => {
    const blocked = await browser.newContext();
    await blocked.addInitScript(() => {
      for (const name of ['localStorage', 'indexedDB']) Object.defineProperty(window, name, { get() { throw new DOMException('denied', 'SecurityError'); } });
    });
    const tab = await blocked.newPage();
    await tab.goto(base + '#activity/guidedEssay');
    await tab.locator('#guided-line').fill(draft);
    await tab.locator('#guided-vocabulary').click();
    await tab.locator('#lookup-search').fill('庞大');
    await expect(tab.locator('#lookup-results')).toContainText('巨大');
    await tab.getByRole('button', { name: '关闭词语库' }).click();
    await expect(tab.locator('#guided-line')).toHaveValue(draft);
    await blocked.close();
  });
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: fileURLToPath(new URL('../test-results/lookup-failure.png', import.meta.url)) });
  throw error;
} finally {
  await writeFile(new URL('../test-results/vocabulary-dialog-report.json', import.meta.url), JSON.stringify({ results, errors }, null, 2));
  await browser.close();
}
