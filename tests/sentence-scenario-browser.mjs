import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createTeacherHandler } from '../server/ai-handler.js';
import { createTutorLimiter } from '../server/ai-rate-limit.js';
import { TUTOR_ACTION as A, TUTOR_ACTIVITY as B, activityTutorActions } from '../js/tutor-actions.js';
import { runningScenario, runningSentence, runningResult } from './sentence-scenario-fixtures.mjs';

const base = process.env.TEST_URL || 'http://localhost:4173/';
let browser;
before(async () => {
  await mkdir(new URL('../test-results/scenario/', import.meta.url), { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : process.platform === 'win32' ? { channel: 'msedge' } : {}) });
});
after(async () => browser?.close());
const actions = activityTutorActions[B.SENTENCE];
const clickAI = (page, action) => page.locator(`[data-ai-action="${action}"]`).click();
const close = (page) => page.locator('#modal [data-close-modal]').click();
const done = (page) => page.locator('.ai-result[aria-busy="false"] h3').filter({ hasText: '轮到你了' }).waitFor();
async function fixture(t, { generate, viewport = { width: 390, height: 844 } } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: true, serviceWorkers: 'block' });
  t.after(() => context.close());
  const page = await context.newPage(), requests = [], errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  const endpoint = createTeacherHandler({
    env: { GEMINI_API_KEY: 'mock-only' }, logger: { info() {}, warn() {} },
    limiter: createTutorLimiter({ perClient: 40, total: 200 }),
    vocabulary: async () => ({ getAllWords: () => [], getWordById() {} }),
    generate: generate || (async (input) => JSON.stringify(runningResult(input.action, input.context))),
  });
  await page.route('**/api/gemini', async (route) => {
    requests.push(route.request().postDataJSON());
    const response = await endpoint(new Request(route.request().url(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: route.request().postData() }));
    await route.fulfill({ status: response.status, json: await response.json() });
  });
  await page.goto(`${base}#activity/builder?word=3-尽-尽力&mode=free`);
  await page.locator('#own-sentence').waitFor();
  return { page, requests };
}
async function scenario(page, text = runningScenario) {
  await page.locator('#sentence-context').selectOption('你自己想到的情境');
  await page.locator('#custom-sentence-context').fill(text);
}
async function custom(page) {
  await page.locator('[data-keyword-mode="custom"]').click();
  await page.locator('#custom-keyword').fill('坚持');
  await page.locator('#custom-keyword-form button').click();
}

test('all five buttons use identical scenario, draft, year and committed keyword in both modes, with relevant structured output', async (t) => {
  const { page, requests } = await fixture(t);
  for (const mode of ['builtin', 'custom']) {
    if (mode === 'custom') await custom(page);
    await scenario(page);
    const keyword = mode === 'builtin' ? '尽力' : '坚持';
    const sentence = runningSentence.replace('坚持', keyword);
    await page.locator('#own-sentence').fill(sentence);
    for (const action of actions) {
      await clickAI(page, action); await done(page);
      const input = requests.at(-1);
      assert.deepEqual({ ...input.context, availableVocabularyIds: undefined }, {
        topic: keyword, keywordMode: mode, situation: runningScenario, studentSentence: sentence,
        studentYearLevel: 3, availableVocabularyIds: undefined,
      });
      const text = await page.locator('.ai-result').textContent();
      assert.ok(text.includes(keyword));
      assert.match(text, /长跑|终点|加油/);
      assert.ok(!text.includes('每天完成作业'));
      if ([A.SENTENCE_HINT, A.VOCABULARY_HELP].includes(action)) await expect(page.locator('.ai-example')).toHaveCount(2);
      if (action === A.SENTENCE_HINT) {
        await page.evaluate(() => { navigator.clipboard.writeText = async (text) => { window.__scenarioExampleCopy = text; }; });
        const before = requests.length;
        await page.locator('[data-ai-example-copy="0"]').click();
        assert.ok((await page.evaluate(() => window.__scenarioExampleCopy)).includes(keyword));
        assert.equal(requests.length, before);
      }
      if (action === A.SENTENCE_HINT) await expect(page.locator('.ai-result')).toContainText('你可以这样写');
      if (action === A.SENTENCE_CHECK) await expect(page.locator('.ai-result')).toContainText('写得好的地方');
      if (action === A.SENTENCE_EXPAND) await expect(page.locator('.ai-result')).toContainText('我加入了什么');
      if (action === A.SENTENCE_VIVID) await expect(page.locator('.ai-result')).toContainText('生动在哪里');
      if (action === A.VOCABULARY_HELP) {
        await expect(page.locator('.ai-result .word-card')).toHaveCount(4);
        await expect(page.locator('.ai-result')).toContainText('鼓起勇气');
      }
      await close(page);
      await expect(page.locator('#own-sentence')).toHaveValue(sentence);
      await expect(page.locator('#custom-sentence-context')).toHaveValue(runningScenario);
    }
  }
  assert.equal(requests.length, 10);
});

test('all five politely reject a blank custom scenario without network calls or draft loss', async (t) => {
  const { page, requests } = await fixture(t);
  await custom(page); await scenario(page, '   ');
  await page.locator('#own-sentence').fill(runningSentence);
  for (const action of actions) {
    await clickAI(page, action);
    await expect(page.locator('#modal [role="alert"]')).toContainText('请先填写“我想写的情境”');
    await close(page);
  }
  assert.equal(requests.length, 0);
  await expect(page.locator('#own-sentence')).toHaveValue(runningSentence);
});

test('hint can start from a described scenario; sentence-required tools still protect empty drafts, and partial writing is included', async (t) => {
  const { page, requests } = await fixture(t);
  await custom(page); await scenario(page);
  for (const action of [A.SENTENCE_CHECK, A.SENTENCE_EXPAND, A.SENTENCE_VIVID]) {
    await clickAI(page, action);
    await expect(page.locator('#modal [role="alert"]')).toContainText('先写一句话');
    await close(page);
  }
  assert.equal(requests.length, 0);
  await clickAI(page, A.SENTENCE_HINT); await done(page); await close(page);
  assert.equal(requests[0].context.studentSentence, '');
  await page.locator('#own-sentence').fill('我跑到一半很累，但我坚持');
  await clickAI(page, A.SENTENCE_EXPAND); await done(page); await close(page);
  assert.equal(requests.at(-1).context.studentSentence, '我跑到一半很累，但我坚持');
});

for (const action of actions) test(`${action}: scenario and sentence edits invalidate in-flight or completed results and never trigger another request`, async (t) => {
  const { page, requests } = await fixture(t);
  await custom(page); await scenario(page); await page.locator('#own-sentence').fill(runningSentence);
  for (const field of ['custom-sentence-context', 'own-sentence']) {
    await page.evaluate(async (action) => {
      const { aiTeacher } = await import('/js/ai-teacher.js');
      window.__originalTeacher = aiTeacher[action];
      aiTeacher[action] = () => new Promise((resolve) => { window.__oldResult = resolve; });
    }, action);
    await clickAI(page, action);
    const newValue = field === 'own-sentence' ? '我虽然很累，还是坚持跑到了终点。' : runningScenario + '我想写清楚听到加油后的想法。';
    await page.evaluate(({ field, value }) => {
      const input = document.getElementById(field);
      input.value = value;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
    }, { field, value: newValue });
    await expect(page.locator('#modal')).not.toBeVisible();
    await page.evaluate(async ({ action, data }) => {
      window.__oldResult(data);
      (await import('/js/ai-teacher.js')).aiTeacher[action] = window.__originalTeacher;
    }, { action, data: runningResult(action, undefined, true) });
    await expect(page.locator('#modal')).not.toBeVisible();
    const before = requests.length;
    await clickAI(page, action); await done(page);
    assert.equal(requests.length, before + 1);
    assert.equal(requests.at(-1).context[field === 'own-sentence' ? 'studentSentence' : 'situation'], newValue);
    await close(page);
  }
  // An already rendered suggestion is invalidated too.
  await clickAI(page, action); await done(page);
  await page.evaluate(() => {
    const input = document.querySelector('#custom-sentence-context');
    input.value += '请保留我的事实。'; input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await expect(page.locator('#modal')).not.toBeVisible();
});

test('block mode uses the same editable scenario and restores it through tile redraws, mode switches and reload', async (t) => {
  const { page, requests } = await fixture(t);
  const item = await page.evaluate(async () => {
    const { vocabulary } = await import('/js/state.js'); const { builders } = await import('/data/content.js');
    const item = vocabulary.find((word) => builders[word.word]); return { id: item.id, word: item.word };
  });
  await page.goto(`${base}#activity/builder?word=${encodeURIComponent(item.id)}`);
  await scenario(page);
  for (const part of ['when', 'who', 'event', 'action']) await page.locator(`[data-part="${part}:0"]`).click();
  const text = await page.locator('.sentence-display').textContent();
  await expect(page.locator('#custom-sentence-context')).toHaveValue(runningScenario);
  await clickAI(page, A.SENTENCE_HINT); await done(page); await close(page);
  assert.equal(requests.at(-1).context.situation, runningScenario);
  assert.equal(requests.at(-1).context.studentSentence, text);
  await custom(page); await page.locator('[data-keyword-mode="builtin"]').click();
  await expect(page.locator('#custom-sentence-context')).toHaveValue(runningScenario);
  await page.reload();
  await expect(page.locator('#custom-sentence-context')).toHaveValue(runningScenario);
  await expect(page.locator('[data-ai-action]')).toHaveCount(5);
});

test('scenario IME keeps input identity and focus, saves text, and emits no automatic Gemini requests', async (t) => {
  const { page, requests } = await fixture(t);
  await custom(page); await scenario(page, '');
  await page.locator('#custom-sentence-context').focus();
  await page.evaluate((scenario) => {
    const input = document.querySelector('#custom-sentence-context'); window.__scenarioInput = input;
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = scenario; input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: scenario }));
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: scenario }));
  }, runningScenario);
  assert.ok(await page.evaluate(() => window.__scenarioInput === document.activeElement));
  assert.equal(requests.length, 0);
  await page.reload(); await expect(page.locator('#custom-sentence-context')).toHaveValue(runningScenario);
});

test('unrelated keyword-containing output stays hidden after one automatic retry; manual retry recovers without changing student work', async (t) => {
  let providerCalls = 0;
  const { page, requests } = await fixture(t, { generate: async (input) => {
    const data = runningResult(input.action, input.context);
    if (++providerCalls <= 2) data.example = '我每天坚持完成作业。';
    return JSON.stringify(data);
  } });
  await custom(page); await scenario(page); await page.locator('#own-sentence').fill(runningSentence);
  await clickAI(page, A.SENTENCE_VIVID);
  await expect(page.locator('#modal [role="alert"]')).toContainText('情境不符');
  await expect(page.locator('.ai-result')).not.toContainText('每天坚持完成作业');
  assert.equal(providerCalls, 2); assert.equal(requests.length, 1);
  await page.locator('[data-ai-retry]').click(); await done(page);
  assert.equal(providerCalls, 3); assert.equal(requests.length, 2);
  await close(page);
  await expect(page.locator('#own-sentence')).toHaveValue(runningSentence);
  await expect(page.locator('#custom-sentence-context')).toHaveValue(runningScenario);
});

test('scenario-aware dialogs and existing controls fit phone, tablet and desktop orientations', async (t) => {
  const { page } = await fixture(t);
  await custom(page); await scenario(page); await page.locator('#own-sentence').fill(runningSentence);
  for (const [width, height] of [[320,740],[844,390],[768,1024],[1024,768],[1366,900]]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('[data-ai-action]')).toHaveCount(5);
    const input = await page.locator('#custom-sentence-context').boundingBox();
    assert.ok(input.x >= 0 && input.x + input.width <= width + 1);
    await clickAI(page, A.VOCABULARY_HELP); await done(page);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const dimensions = await page.locator('#modal').evaluate((modal) => ({ width: modal.clientWidth, scroll: modal.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.width + 1);
    await page.screenshot({ path: fileURLToPath(new URL(`../test-results/scenario/dialog-${width}x${height}.png`, import.meta.url)) });
    await close(page);
  }
});
