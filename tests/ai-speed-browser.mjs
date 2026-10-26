import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createTeacherHandler } from '../server/ai-handler.js';
import { resultFor } from './tutor-fixtures.mjs';
const base = process.env.TEST_URL || 'http://localhost:4173/';
let browser;
before(async () => { browser = await chromium.launch({ headless: true,
  ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : process.platform === 'win32' ? { channel: 'msedge' } : {}),
}); });
after(async () => browser?.close());
const close = (page) => page.locator('#modal [data-close-modal]').click();
const done = (page) => page.locator('.ai-result[aria-busy="false"] h3').filter({ hasText: '轮到你了' }).waitFor();
async function fixture(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  t.after(() => context.close());
  const page = await context.newPage(), requests = [], models = [], errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  const endpoint = createTeacherHandler({ env: { GEMINI_API_KEY: 'mock-only' }, logger: { info() {}, warn() {} },
    generate: async (input, config) => { models.push(config.model); return JSON.stringify(resultFor(input.action, input.context)); }, ...options,
  });
  await page.route('**/api/gemini', async (route) => {
    requests.push(route.request().postDataJSON());
    const response = await endpoint(new Request(route.request().url(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: route.request().postData() }));
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  await page.goto(`${base}#activity/builder?word=3-解-解决&mode=free`);
  await page.locator('#own-sentence').waitFor();
  return { page, requests, models };
}

test('twelve requests succeed promptly across both activities with env 12; the thirteenth is limited without losing the draft', async (t) => {
  const { page, requests, models } = await fixture(t, { env: { GEMINI_API_KEY: 'mock-only', AI_CLIENT_RPM: '12' } });
  for (let index = 0; index < 6; index++) {
    await page.locator('#own-sentence').fill(`第${index + 1}次，我和同学一起解决了问题。`);
    await page.locator('[data-ai-action="sentence_check"]').click(); await done(page); await close(page);
  }
  await page.goto(`${base}#activity/guidedEssay`); await page.locator('#guided-line').waitFor();
  for (let index = 0; index < 6; index++) {
    await page.locator('#guided-line').fill(`第${index + 1}次练习，我写下了运动会上的经历和感受。`);
    await page.locator('[data-ai-action="paragraph_review"]').click(); await done(page); await close(page);
  }
  assert.equal(requests.length, 12);
  assert.deepEqual(new Set(models), new Set(['gemini-3.5-flash-lite']));
  await expect(page.locator('[data-ai-action]:disabled')).toHaveCount(0);
  const detail = await page.evaluate(() => performance.getEntriesByName('ai-teacher:guidedEssay:paragraph_review').map((entry) => entry.detail));
  assert.deepEqual(detail, [{ outcome: 'success', attempts: 1 }]);
  const draft = '第十三次练习，我继续写下运动会上的经历和感受。';
  await page.locator('#guided-line').fill(draft);
  await page.locator('[data-ai-action="paragraph_review"]').click();
  await expect(page.locator('#modal [role="alert"]')).toContainText('AI老师需要休息约');
  assert.equal(requests.length, 13); assert.equal(models.length, 12);
  await close(page);
  await expect(page.locator('#guided-line')).toHaveValue(draft);
});

test('provider quota message honors cooldown, performs no automatic retry, and restores manual retry in the open dialog', async (t) => {
  let clock = 0, calls = 0;
  const { page, requests } = await fixture(t, { now: () => clock, generate: async (input) => {
    if (++calls === 1) throw { status: 429, headers: new Headers({ 'Retry-After': '2' }) };
    return JSON.stringify(resultFor(input.action, input.context));
  } });
  await page.clock.install();
  await page.locator('#own-sentence').fill('我和同学一起解决了问题。');
  await page.locator('[data-ai-action="sentence_check"]').click();
  await expect(page.locator('#modal [role="alert"]')).toContainText('Gemini API 已达到当前使用额度');
  await expect(page.locator('[data-ai-retry]')).toBeHidden();
  await expect(page.locator('[data-ai-action]:disabled')).toHaveCount(5);
  clock = 2100; await page.clock.fastForward(2100);
  await expect(page.locator('[data-ai-retry]')).toBeVisible();
  assert.equal(calls, 1); assert.equal(requests.length, 1);
  await page.locator('[data-ai-retry]').click(); await done(page); await close(page);
  assert.equal(calls, 2); assert.equal(requests.length, 2);
  await expect(page.locator('#own-sentence')).toHaveValue('我和同学一起解决了问题。');
});

test('503 keeps local prompt copying available and separate from Gemini, preserving sentence and essay drafts', async (t) => {
  const { page, requests } = await fixture(t, { generate: async () => { throw { status: 503, headers: new Headers({ 'Retry-After': '30' }) }; } });
  await page.evaluate(() => { navigator.clipboard.writeText = async (text) => { window.__prompt = text; }; });
  await page.locator('#own-sentence').fill('我和同学一起解决了问题。');
  await page.locator('[data-ai-action="sentence_check"]').click();
  await expect(page.locator('#modal [role="alert"]')).toContainText('复制提示词'); await close(page);
  await expect(page.locator('[data-ai-action]:disabled')).toHaveCount(5);
  await page.locator('[data-sentence-copy-prompt="sentence_check"]').click();
  assert.ok((await page.evaluate(() => window.__prompt)).includes('解决'));
  assert.equal(requests.length, 1);
  await page.goto(`${base}#activity/guidedEssay`); await page.locator('#guided-line').waitFor();
  await page.locator('#guided-line').fill('我和同学一起参加了运动会。');
  await page.locator('[data-external-ai-launcher]').click();
  await page.locator('[data-external-ai-action="paragraph_expand"]').click();
  assert.ok((await page.evaluate(() => window.__prompt)).includes('我和同学一起参加了运动会。'));
  assert.equal(requests.length, 1);
  await expect(page.locator('#guided-line')).toHaveValue('我和同学一起参加了运动会。');
});
