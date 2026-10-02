import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import titles from '../data/essay-titles.json' with { type: 'json' };
import contents from '../data/essay-contents.json' with { type: 'json' };
import { splitChineseSentences } from '../js/essay-sentence-service.js';
const base = process.env.TEST_URL || 'http://localhost:4183/';

test('production assets deliver 1,000 records, offline cache preserves drafts, and update notice never forces reload', async (t) => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext(), page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}#activity/guidedEssay`);
  await page.locator('#guided-line').waitFor();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const data = await page.evaluate(async () => {
    const version = await (await fetch('/version.json', { cache: 'no-store' })).json();
    const cache = await caches.open(version.version);
    return { version: version.version, cacheNames: await caches.keys(), titleData: await (await cache.match('/data/essay-titles.json')).json(), contentData: await (await cache.match('/data/essay-contents.json')).json(), sourceStatus: (await fetch('/data/Mandarin_Essay_Master_1000_Titles.xlsx')).status };
  });
  assert.deepEqual(data.titleData, titles);
  assert.deepEqual(data.contentData, contents);
  assert.ok(data.cacheNames.includes(data.version));
  assert.equal(data.sourceStatus, 404);
  const draft = '生产构建中的原文，离线和更新时都要保留。';
  await page.locator('#guided-line').fill(draft);
  await page.waitForTimeout(500);
  const selected = await page.locator('#training-topic').inputValue();
  await context.setOffline(true);
  await page.reload();
  await page.locator('#guided-line').waitFor();
  assert.equal(await page.locator('#training-topic').inputValue(), selected);
  assert.equal(await page.locator('#guided-line').inputValue(), draft);
  await context.setOffline(false);
  // Browser routing cannot reliably intercept requests controlled by a Service Worker.
  // Exercise the built update watcher in a separate context after verifying real offline caching.
  const updateContext = await browser.newContext({ serviceWorkers: 'block' }), updatePage = await updateContext.newPage();
  await updatePage.goto(`${base}#activity/guidedEssay`);
  await updatePage.locator('#guided-line').waitFor();
  await updatePage.locator('#guided-line').fill(draft);
  await updatePage.route('**/version.json', (route) => route.fulfill({ json: { version: 'huawen-lab-next-test' } }));
  await updatePage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await updatePage.locator('.deployment-update-notice').waitFor();
  assert.equal(await updatePage.locator('#guided-line').inputValue(), draft);
  await updatePage.waitForTimeout(500);
  assert.equal(await updatePage.evaluate(() => JSON.parse(localStorage.getItem('huawen-lab-v1')).drafts[`guided-essay:${document.querySelector('#training-topic').value}-c01`].text), draft);
  await updatePage.locator('.deployment-update-notice button').click();
  await updatePage.locator('#guided-line').waitFor();
  assert.equal(await updatePage.locator('#guided-line').inputValue(), draft);
  assert.deepEqual(errors, []);
});

test('production model speech highlights and scrolls sentences; switching essays cancels stale playback', async (t) => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    window.speechCalls = [];
    window.cancelCount = 0;
    window.scrollCalls = [];
    const originalScroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...args) { if (this.matches('[data-essay-sentence]')) window.scrollCalls.push(this.textContent); return originalScroll.apply(this, args); };
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; } } });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => [{ name: 'Mandarin', lang: 'zh-CN' }], addEventListener() {}, speak(utterance) { window.speechCalls.push(utterance); }, cancel() { window.cancelCount++; }, pause() {}, resume() {} } });
  });
  const page = await context.newPage();
  await page.goto(`${base}#activity/modelEssay`);
  await page.locator('#training-topic').waitFor();
  await page.locator('#training-topic').selectOption(titles[0].id);
  const reader = page.locator('.model-reading');
  await reader.locator('[data-speak-essay]').click();
  await page.waitForFunction(() => window.speechCalls.length > 0);
  assert.equal(await page.evaluate(() => window.speechCalls[0].text), splitChineseSentences(contents[0].content.split('\n')[0])[0]);
  await page.evaluate(() => window.speechCalls[0].onstart?.({}));
  assert.equal(await reader.locator('.essay-sentence--active').count(), 1);
  await page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); window.speechCalls[0].onend?.({}); });
  assert.ok((await page.evaluate(() => window.scrollCalls)).length > 0);
  const cancels = await page.evaluate(() => window.cancelCount);
  await page.locator('#training-topic').selectOption(titles.at(-1).id);
  assert.equal(await page.locator('.essay-sentence--active').count(), 0);
  assert.ok(await page.evaluate((old) => window.cancelCount > old, cancels));
  await page.evaluate(() => window.speechCalls[0].onend?.({}));
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.speechCalls.length), 2);
});
