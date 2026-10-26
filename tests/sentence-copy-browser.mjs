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
const actions = activityTutorActions[B.SENTENCE];
let browser;
before(async () => {
  await mkdir(new URL('../test-results/sentence-copy/', import.meta.url), { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : process.platform === 'win32' ? { channel: 'msedge' } : {}) });
});
after(async () => browser?.close());
async function fixture(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
  t.after(() => context.close());
  await context.addInitScript(() => {
    window.__copies = [];
    navigator.clipboard.writeText = async (text) => { window.__copies.push(text); };
  });
  const page = await context.newPage(), requests = [], errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  const endpoint = createTeacherHandler({ env: { GEMINI_API_KEY: 'mock-only' }, logger: { info() {}, warn() {} },
    limiter: createTutorLimiter({ perClient: 40, total: 100 }),
    vocabulary: async () => ({ getAllWords: () => [], getWordById() {} }),
    generate: options.generate || (async (input) => JSON.stringify(runningResult(input.action, input.context))),
  });
  await page.route('**/api/gemini', async (route) => {
    requests.push(route.request().postDataJSON());
    if (options.unavailable) return route.fulfill({ status: 503, json: { ok: false, error: { code: 'AI_NOT_CONFIGURED' } } });
    const response = await endpoint(new Request(route.request().url(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: route.request().postData() }));
    await route.fulfill({ status: response.status, json: await response.json() });
  });
  await page.goto(`${base}#activity/builder?word=3-尽-尽力&mode=free`);
  await page.locator('#own-sentence').waitFor();
  return { page, requests };
}
const copyPrompt = (page, action) => page.locator(`[data-sentence-copy-prompt="${action}"]`);
const done = (page) => page.locator('.ai-result[aria-busy="false"] h3').filter({ hasText: '轮到你了' }).waitFor();
const close = (page) => page.locator('#modal [data-close-modal]').click();
async function setup(page, custom = true) {
  if (custom) {
    await page.locator('[data-keyword-mode="custom"]').click();
    await page.locator('#custom-keyword').fill('坚持');
    await page.locator('#custom-keyword-form button').click();
  }
  await page.locator('#sentence-context').selectOption('你自己想到的情境');
  await page.locator('#custom-sentence-context').fill(runningScenario);
  await page.locator('#own-sentence').fill(custom ? runningSentence : runningSentence.replace('坚持', '尽力'));
}
const snapshot = (page) => page.evaluate(async () => {
  const { state } = await import('/js/state.js');
  return { state: JSON.stringify(state), sentence: document.querySelector('#own-sentence').value,
    scenario: document.querySelector('#custom-sentence-context').value,
    keyword: document.querySelector('#active-keyword').textContent, hash: location.hash, history: history.length };
});
const lastCopy = (page) => page.evaluate(() => window.__copies.at(-1));

test('all five actions copy every validated structured model exactly, in both modes, without API or state changes', async (t) => {
  const { page, requests } = await fixture(t);
  for (const customMode of [false, true]) {
    await setup(page, customMode);
    for (const action of actions) {
      const before = await snapshot(page);
      await page.locator(`[data-ai-action="${action}"]`).click(); await done(page);
      const data = runningResult(action, requests.at(-1).context, true);
      const expected = action === A.SENTENCE_HINT ? data.examples
        : action === A.SENTENCE_CHECK ? [data.suggestedRevision]
        : action === A.SENTENCE_EXPAND ? data.levels.map((level) => level.example)
        : action === A.SENTENCE_VIVID ? [data.example]
        : [...data.recommendations.map((item) => item.exampleUsage), ...data.examples];
      const buttons = page.locator('.ai-result [data-ai-example-copy], .ai-result [data-ai-sentence-copy]');
      await expect(buttons).toHaveCount(expected.length);
      const calls = requests.length;
      for (let index = 0; index < expected.length; index++) {
        await buttons.nth(index).click();
        assert.equal(await lastCopy(page), expected[index]);
        await expect(page.locator('#toast')).toContainText('已复制');
        assert.equal(requests.length, calls);
      }
      await close(page);
      assert.deepEqual(await snapshot(page), before);
    }
  }
  assert.equal(requests.length, 10);
});

test('all five prompt icons work independently of a failed Gemini API, use live context and copy readable Chinese on the first click', async (t) => {
  const { page, requests } = await fixture(t, { unavailable: true });
  await setup(page, false);
  await page.locator(`[data-ai-action="${A.SENTENCE_HINT}"]`).click();
  await expect(page.locator('#modal [role="alert"]')).toContainText('暂时还不能使用');
  await close(page);
  await page.context().setOffline(true);
  const expectedTasks = ['任务：给我提示', '任务：检查句子', '任务：帮我扩写', '任务：写得更生动', '任务：推荐好词'];
  for (const customMode of [false, true]) {
    await setup(page, customMode);
    await page.locator('#sentence-selfcheck').check();
    const before = await snapshot(page);
    for (const [index, action] of actions.entries()) {
      for (let repeat = 0; repeat < 2; repeat++) {
        const count = await page.evaluate(() => window.__copies.length);
        await copyPrompt(page, action).click();
        await page.waitForFunction((count) => window.__copies.length === count + 1, count);
        const prompt = await lastCopy(page);
        for (const text of [customMode ? '坚持' : '尽力', runningScenario, customMode ? runningSentence : runningSentence.replace('坚持', '尽力'), 'Standard 3', expectedTasks[index], '不要输出 JSON', '不要把答案放进 Markdown 代码框']) assert.ok(prompt.includes(text), text);
        assert.ok(!/\{activeKeyword\}|\{studentScenario\}|\/api\/gemini|mock-only|system_instruction/u.test(prompt));
        assert.equal(requests.length, 1);
        await expect(page.locator('#modal')).not.toBeVisible();
        assert.deepEqual(await snapshot(page), before);
      }
    }
  }
});

test('scenario, draft, committed keyword and year edits appear immediately in copied prompts, including empty drafts', async (t) => {
  const { page, requests } = await fixture(t);
  await setup(page);
  await page.locator('#custom-sentence-context').fill('星期六，家人一起为奶奶庆祝生日。');
  await page.locator('#own-sentence').fill('我们兴高采烈地为奶奶庆祝生日。\n奶奶笑了。');
  await page.locator('#custom-keyword').fill('兴高采烈');
  await copyPrompt(page, A.SENTENCE_HINT).click();
  assert.ok((await lastCopy(page)).includes('【指定词语开始 · 造句学习材料】\n坚持\n'));
  await page.locator('#custom-keyword-form button').click();
  // Drafts remain target-specific, so enter the new target's writing/scenario.
  await page.locator('#sentence-context').selectOption('你自己想到的情境');
  await page.locator('#custom-sentence-context').fill('星期六，家人一起为奶奶庆祝生日。');
  const writing = '我们兴高采烈地为奶奶庆祝生日。\n奶奶笑了。';
  await page.locator('#own-sentence').fill(writing);
  await page.evaluate(async () => { (await import('/js/state.js')).state.settings.grade = '4'; });
  for (const action of actions) {
    await copyPrompt(page, action).click();
    const prompt = await lastCopy(page);
    assert.ok(prompt.includes('兴高采烈') && prompt.includes('星期六，家人一起为奶奶庆祝生日。'));
    assert.ok(prompt.includes(writing) && prompt.includes('Standard 4'));
    assert.ok(!prompt.includes(runningScenario));
  }
  await page.locator('#own-sentence').fill('');
  await copyPrompt(page, A.SENTENCE_CHECK).click();
  assert.match(await lastCopy(page), /尚未写句子/);
  assert.equal(requests.length, 0);
});

test('clipboard fallback works inside the AI dialog; denial and unsupported copying report failure honestly', async (t) => {
  const { page, requests } = await fixture(t);
  await setup(page);
  await page.locator(`[data-ai-action="${A.SENTENCE_VIVID}"]`).click(); await done(page);
  const expected = runningResult(A.SENTENCE_VIVID).example;
  for (const mode of ['unavailable', 'denied', 'failure', 'throw']) {
    await page.evaluate((mode) => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'unavailable' ? undefined : { writeText: async () => { throw new Error('Denied'); } } });
      document.execCommand = () => {
        window.__fallback = { text: document.activeElement.value, inDialog: !!document.activeElement.closest('#modal') };
        if (mode === 'throw') throw new Error('Unsupported');
        return mode !== 'failure';
      };
    }, mode);
    await page.locator('[data-ai-sentence-copy="vivid"]').click();
    assert.deepEqual(await page.evaluate(() => window.__fallback), { text: expected, inDialog: true });
    await expect(page.locator('#toast')).toContainText(['failure', 'throw'].includes(mode) ? '未能复制' : '已复制');
    await expect(page.locator('#modal textarea')).toHaveCount(0);
  }
  await close(page);
  // Failure of both APIs also stays API-free for every external prompt.
  for (const action of actions) {
    await copyPrompt(page, action).click();
    await expect(page.locator('#toast')).toHaveText('未能复制提示词，请检查剪贴板权限后重试。');
  }
  assert.equal(requests.length, 1);
});

test('copy controls are keyboard accessible; prompt copying preserves active Chinese composition input identity and focus', async (t) => {
  const { page, requests } = await fixture(t);
  await setup(page);
  for (const action of actions) {
    await page.locator(`[data-ai-action="${action}"]`).focus();
    await page.keyboard.press('Tab');
    await expect(copyPrompt(page, action)).toBeFocused();
    await expect(copyPrompt(page, action)).toHaveAttribute('title', '复制提示词');
    await page.keyboard.press('Enter');
    await expect(page.locator('#toast')).toContainText('提示词已复制');
  }
  await page.locator('#custom-sentence-context').focus();
  await page.evaluate(() => {
    const input = document.querySelector('#custom-sentence-context'); window.__imeInput = input;
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = '运动会长跑时，同学们为我加油。';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: input.value }));
  });
  await copyPrompt(page, A.SENTENCE_HINT).click();
  assert.ok(await page.evaluate(() => document.activeElement === window.__imeInput));
  assert.ok((await lastCopy(page)).includes('运动会长跑时，同学们为我加油。'));
  await page.locator('#custom-sentence-context').dispatchEvent('compositionend', { data: '运动会长跑时，同学们为我加油。' });
  assert.equal(requests.length, 0);
});

test('rejected AI output has no sentence copy controls and stale rendered results cannot be copied for a changed scenario', async (t) => {
  const { page, requests } = await fixture(t, { generate: async (input) => {
    const data = runningResult(input.action, input.context);
    if (input.action === A.SENTENCE_VIVID) data.example = '我每天坚持完成作业。';
    return JSON.stringify(data);
  } });
  await setup(page);
  await page.locator(`[data-ai-action="${A.SENTENCE_VIVID}"]`).click();
  await expect(page.locator('#modal [role="alert"]')).toContainText('情境不符');
  await expect(page.locator('.ai-result [data-ai-sentence-copy], .ai-result [data-ai-example-copy]')).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.__copies.length), 0);
  await close(page);
  for (const action of [A.SENTENCE_HINT, A.SENTENCE_CHECK]) {
    await page.locator(`[data-ai-action="${action}"]`).click(); await done(page);
    await page.evaluate(() => { document.querySelector('#custom-sentence-context').value += '请保留我的情景。'; });
    // Even without an input event, the existing request fingerprint is checked.
    await page.locator('.ai-result [data-ai-sentence-copy], .ai-result [data-ai-example-copy]').first().click();
    assert.equal(await page.evaluate(() => window.__copies.length), 0);
    await close(page);
  }
  assert.equal(requests.length, 3);
});

test('a complete model returned in a scaffold field can also be copied exactly without copying its explanatory heading', async (t) => {
  const text = '听到同学的加油声后，我坚持跑到了终点。';
  const { page, requests } = await fixture(t, { generate: async (input) => {
    const data = runningResult(input.action, input.context); data.tryYourself = text;
    return JSON.stringify(data);
  } });
  await setup(page);
  await page.locator(`[data-ai-action="${A.SENTENCE_VIVID}"]`).click(); await done(page);
  await page.locator('[data-ai-sentence-copy="try-yourself"]').click();
  assert.equal(await lastCopy(page), text);
  assert.equal(requests.length, 1);
});

test('paired controls have distinct touch targets and fit phone, tablet and desktop, including rotation', async (t) => {
  const { page, requests } = await fixture(t);
  await setup(page);
  for (const [width, height] of [[320,740],[390,844],[844,390],[768,1024],[1024,768],[1366,900]]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('[data-ai-action]')).toHaveCount(5);
    await expect(page.locator('[data-sentence-copy-prompt]')).toHaveCount(5);
    for (const action of actions) {
      const main = await page.locator(`[data-ai-action="${action}"]`).boundingBox();
      const copy = await copyPrompt(page, action).boundingBox();
      assert.ok(copy.width >= 44 && copy.height >= 44 && main.height >= 44);
      assert.ok(main.x + main.width <= copy.x + 1 && copy.x + copy.width <= width + 1);
      await copyPrompt(page, action).click();
    }
    assert.equal(requests.length, 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator('#toast').evaluate((toast) => toast.classList.remove('show'));
    await page.locator('.ai-toolbar').screenshot({ path: fileURLToPath(new URL(`../test-results/sentence-copy/toolbar-${width}x${height}.png`, import.meta.url)) });
    await expect(page.locator('#own-sentence')).toHaveValue(runningSentence);
  }
});

test('prompt controls remain singular and live after block redraws, mode switches, navigation and reload', async (t) => {
  const { page, requests } = await fixture(t);
  const id = await page.evaluate(async () => {
    const { vocabulary } = await import('/js/state.js'); const { builders } = await import('/data/content.js');
    return vocabulary.find((word) => builders[word.word]).id;
  });
  await page.goto(`${base}#activity/builder?word=${encodeURIComponent(id)}`);
  for (const part of ['when', 'who', 'event', 'action']) await page.locator(`[data-part="${part}:0"]`).click();
  await expect(page.locator('[data-sentence-copy-prompt]')).toHaveCount(5);
  let count = await page.evaluate(() => window.__copies.length);
  await copyPrompt(page, A.SENTENCE_EXPAND).click();
  assert.equal(await page.evaluate(() => window.__copies.length), count + 1);
  await page.reload();
  await expect(page.locator('[data-sentence-copy-prompt]')).toHaveCount(5);
  await copyPrompt(page, A.SENTENCE_EXPAND).click();
  assert.equal(await page.evaluate(() => window.__copies.length), 1);
  assert.equal(requests.length, 0);
});
