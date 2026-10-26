import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { TUTOR_ACTION as A, TUTOR_ACTIVITY as B, activityTutorActions } from '../js/tutor-actions.js';
import { resultFor, word } from './tutor-fixtures.mjs';
import { createTeacherHandler } from '../server/ai-handler.js';

const base = process.env.TEST_URL || 'http://localhost:4173/';
const route = 'activity/builder?word=3-解-解决&mode=free';
const sentence = '  我和同学一起讨论，终于解决了问题。\n\n老师说：“你们真棒！”\n';
const output = new URL('../test-results/sentence-builder/', import.meta.url);
let browser;
before(async () => {
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true,
    ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : process.platform === 'win32' ? { channel: 'msedge' } : {}),
  });
});
after(async () => browser?.close());

async function fixture(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, serviceWorkers: 'block', ...options });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(`${base}#${route}`);
  await page.locator('#own-sentence').waitFor();
  await page.evaluate(() => {
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    window.__clipboardWrites = [];
    navigator.clipboard.writeText = async (text) => {
      window.__clipboardWrites.push(text);
      return write(text);
    };
  });
  return page;
}

async function assertCopied(page, text) {
  // Assert exact input to the API, then native clipboard representation. Windows
  // converts LF to CRLF; all blank lines, punctuation and whitespace must remain.
  assert.equal(await page.evaluate(() => window.__clipboardWrites.at(-1)), text);
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), process.platform === 'win32' ? text.replace(/\n/g, '\r\n') : text);
}

const snapshot = (page) => page.evaluate(async () => {
  const { state } = await import('/js/state.js');
  return {
    text: document.querySelector('#own-sentence').value,
    scenario: document.querySelector('#sentence-context').value,
    checked: document.querySelector('#sentence-selfcheck').checked,
    title: document.querySelector('.activity-title-row').textContent,
    example: document.querySelector('.quote').textContent,
    hash: location.hash, historyLength: history.length,
    draft: JSON.stringify(state.drafts), xp: state.xp,
    finished: !document.querySelector('#activity-complete').hidden,
  };
});

test('builder loads 50 grouped presets plus custom, keeping the existing default', async (t) => {
  const page = await fixture(t);
  await expect(page.locator('.activity-title-row')).toContainText('造句积木');
  await expect(page.locator('#sentence-context option')).toHaveCount(51);
  await expect(page.locator('#sentence-context optgroup')).toHaveCount(5);
  await expect(page.locator('#sentence-context')).toHaveValue('在学校');
  await page.locator('#own-sentence').fill(sentence);
  for (const scenario of ['和家人相处', '与朋友一起', '第一次尝试新事物时', '你自己想到的情境']) {
    await page.locator('#sentence-context').selectOption(scenario);
    await expect(page.locator('#own-sentence')).toHaveValue(sentence);
    await expect(page.locator('#sentence-context')).toHaveValue(scenario);
  }
  await expect(page.locator('#copy-sentence')).toHaveAttribute('type', 'button');
  await expect(page.locator('#copy-sentence')).not.toHaveClass(/primary/);
  await expect(page.locator('#submit-sentence')).toHaveClass(/primary/);
});

test('empty or whitespace-only sentences cannot overwrite the clipboard', async (t) => {
  const page = await fixture(t, { permissions: ['clipboard-read', 'clipboard-write'] });
  await page.evaluate(() => navigator.clipboard.writeText('保留剪贴板原来的内容'));
  for (const text of ['', '  \n\n\t']) {
    await page.locator('#own-sentence').fill(text);
    await expect(page.locator('#copy-sentence')).toBeDisabled();
    await page.locator('#copy-sentence').evaluate((button) => button.click());
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '保留剪贴板原来的内容');
  }
});

test('copy writes only exact text and leaves draft, scenario, checkbox, progress and score unchanged', async (t) => {
  const page = await fixture(t, { permissions: ['clipboard-read', 'clipboard-write'] });
  const texts = ['我因为懒惰，没有完成老师给我的功课。', sentence, '<b>这是我写的句子。</b>'];
  for (const text of texts) {
    await page.locator('#own-sentence').fill(text);
    await page.locator('#sentence-context').selectOption('遇到困难时');
    const before = await snapshot(page);
    await page.locator('#copy-sentence').click();
    await expect(page.locator('#toast')).toHaveText('句子已复制');
    await assertCopied(page, text);
    assert.deepEqual(await snapshot(page), before);
  }
  await page.locator('#sentence-selfcheck').check();
  const checked = await snapshot(page);
  await page.locator('#copy-sentence').click();
  assert.deepEqual(await snapshot(page), checked);
});

test('fallback copies exactly, restores focus, and failure gives useful feedback', async (t) => {
  const page = await fixture(t);
  await page.locator('#own-sentence').fill(sentence);
  for (const mode of ['unavailable', 'denied', 'failure', 'throw']) {
    await page.evaluate((mode) => {
      window.__fallbackText = null;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'unavailable' ? undefined : { writeText: async () => { throw new Error('Permission denied'); } } });
      document.execCommand = (command) => {
        if (command !== 'copy') throw new Error('Unexpected command');
        window.__fallbackText = document.activeElement.value;
        if (mode === 'throw') throw new Error('Copy failed');
        return mode !== 'failure';
      };
    }, mode);
    const before = await snapshot(page);
    await page.locator('#copy-sentence').click();
    await expect(page.locator('#toast')).toHaveText(['failure', 'throw'].includes(mode) ? '未能复制，请长按句子选择文字复制' : '句子已复制');
    assert.equal(await page.evaluate(() => window.__fallbackText), sentence);
    assert.deepEqual(await snapshot(page), before);
    await expect(page.locator('body > textarea')).toHaveCount(0);
    await expect(page.locator('#copy-sentence')).toBeFocused();
  }
});

test('scenario and copy preserve autosave, refresh recovery and one-step Back', async (t) => {
  const page = await fixture(t, { permissions: ['clipboard-read', 'clipboard-write'] });
  await page.locator('#own-sentence').fill(sentence);
  await page.locator('#sentence-context').selectOption('帮助同学时');
  await page.locator('#copy-sentence').click();
  await page.locator('nav a[href="#library"]:visible').first().click();
  await page.locator('#word-search').waitFor();
  await page.locator('[data-navigation-back]').click();
  await expect(page.locator('#own-sentence')).toHaveValue(sentence);
  await expect(page.locator('#sentence-context')).toHaveValue('帮助同学时');
  await page.reload();
  await expect(page.locator('#own-sentence')).toHaveValue(sentence);
  await expect(page.locator('#copy-sentence')).toBeEnabled();
  await expect(page.locator('#sentence-save')).toContainText('草稿');
  await page.locator('#copy-sentence').click();
  // The instrumented API is replaced by reload, so verify the real clipboard.
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), process.platform === 'win32' ? sentence.replace(/\n/g, '\r\n') : sentence);
});

test('copy does not bypass checking, but valid sentence submission still completes normally', async (t) => {
  const page = await fixture(t, { permissions: ['clipboard-read', 'clipboard-write'] });
  await page.locator('#own-sentence').fill('我和同学一起认真讨论，终于解决了班级图书摆放的问题。');
  await page.locator('#copy-sentence').click();
  await expect(page.locator('#activity-complete')).toBeHidden();
  await page.locator('#submit-sentence').click();
  await expect(page.locator('#activity-feedback')).toContainText('勾选自查');
  await page.locator('#sentence-selfcheck').check();
  await page.locator('#submit-sentence').click();
  await expect(page.locator('#activity-complete')).toBeVisible();
});

test('native picker and secondary copy control fit phone, landscape, tablet and desktop', async (t) => {
  const page = await fixture(t, { permissions: ['clipboard-read', 'clipboard-write'] });
  await page.locator('#own-sentence').fill(sentence);
  const sizes = [[320,740],[360,800],[375,812],[390,844],[412,915],[430,932],[740,360],[844,390],[768,1024],[820,1180],[834,1194],[1024,768],[1180,820],[1366,900]];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await page.locator('#sentence-context').selectOption('和朋友合作完成任务时');
    await page.locator('#sentence-context').scrollIntoViewIfNeeded();
    const dimensions = await page.locator('#sentence-context').evaluate((select) => {
      const rect = select.getBoundingClientRect();
      return { tag: select.tagName, size: select.size, multiple: select.multiple, width: rect.width, height: rect.height, right: rect.right };
    });
    assert.equal(dimensions.tag, 'SELECT');
    assert.equal(dimensions.size, 0); // Native popup, not an unbounded inline list.
    assert.equal(dimensions.multiple, false);
    assert.ok(dimensions.height >= 44 && dimensions.right <= width + 1);
    await page.locator('#sentence-context').selectOption('你自己想到的情境');
    await expect(page.locator('#own-sentence')).toHaveValue(sentence);
    await page.locator('#copy-sentence').scrollIntoViewIfNeeded();
    const copy = await page.locator('#copy-sentence').boundingBox();
    const textarea = await page.locator('#own-sentence').boundingBox();
    assert.ok(copy.height >= 44 && copy.x >= 0 && copy.x + copy.width <= width + 1);
    assert.ok(copy.y >= textarea.y + textarea.height);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}x${height}`);
    await page.locator('#copy-sentence').click();
    await expect(page.locator('#toast')).toHaveText('句子已复制');
    if ([320,390,820,1024,1366].includes(width)) {
      await page.locator('#sentence-context').selectOption('和朋友合作完成任务时');
      await page.screenshot({ path: fileURLToPath(new URL(`sentence-${width}.png`, output)), fullPage: true });
    }
  }
});

test('native picker supports keyboard selection, dismissal and keyboard copy', async (t) => {
  const page = await fixture(t, { permissions: ['clipboard-read', 'clipboard-write'] });
  const select = page.locator('#sentence-context');
  await select.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(select).toHaveValue('你自己想到的情境');
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(select).toHaveValue('在学校');
  await select.click();
  await page.keyboard.press('Escape');
  await page.locator('#own-sentence').fill(sentence);
  await page.locator('#copy-sentence').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#toast')).toHaveText('句子已复制');
  await assertCopied(page, sentence);
});

test('other activities using the free-sentence fallback retain their original choices and actions', async (t) => {
  const page = await fixture(t);
  // Directly exercise the shared fallback with a non-builder activity context.
  await page.evaluate(async () => {
    const { freeSentence } = await import('/activities/sentenceBuilder.js');
    const { vocabulary } = await import('/js/state.js');
    freeSentence(document.querySelector('#activity-body'), {
      activity: { id: 'puzzle' }, item: vocabulary[0], difficulty: 'easy',
      signal: new AbortController().signal,
    });
  });
  await expect(page.locator('#sentence-context option')).toHaveCount(4);
  await expect(page.locator('#copy-sentence')).toHaveCount(0);
  await expect(page.locator('#submit-sentence')).toBeVisible();
});

const chooseCustom = async (page, keyword) => {
  await page.locator('[data-keyword-mode="custom"]').click();
  await page.locator('#custom-keyword').fill(keyword);
  await page.locator('#custom-keyword-form button[type="submit"]').click();
};

test('keyword defaults, empty rejection, trimming, replacement and clearing never call Gemini', async (t) => {
  const page = await fixture(t);
  let calls = 0;
  await page.route('**/api/gemini', async (route) => { calls++; await route.abort(); });
  await expect(page.locator('[data-keyword-mode="builtin"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#active-keyword')).toHaveText('解决');
  await page.locator('[data-keyword-mode="custom"]').click();
  await expect(page.locator('#custom-keyword')).toBeVisible();
  for (const text of ['', '   ']) {
    await page.locator('#custom-keyword').fill(text);
    await page.locator('#custom-keyword-form button').click();
    await expect(page.locator('#custom-keyword-error')).toHaveText('请先输入你想练习的词语。');
    await expect(page.locator('#own-sentence')).toHaveCount(0);
  }
  for (const keyword of ['坚持', '勇敢', '保护环境', '兴高采烈', '因为……所以……']) {
    await chooseCustom(page, `  ${keyword}  `);
    await expect(page.locator('#active-keyword')).toHaveText(keyword);
    await expect(page.locator('#custom-keyword')).toHaveValue(keyword);
    await expect(page.locator('#keyword-instruction')).toHaveText(`请用“${keyword}”造一个完整、通顺的句子。`);
    await expect(page.locator('#own-sentence')).toBeVisible();
    await expect(page.locator('.reference-details')).toHaveCount(0);
  }
  await page.locator('#custom-keyword').fill('');
  await expect(page.locator('#active-keyword')).toHaveText('因为……所以……');
  assert.equal(calls, 0);
});

test('IME composition keeps the same focused keyword and sentence inputs and does not confirm on composing Enter', async (t) => {
  const page = await fixture(t);
  await page.locator('[data-keyword-mode="custom"]').click();
  await page.locator('#custom-keyword').focus();
  await page.evaluate(() => {
    const input = document.querySelector('#custom-keyword');
    window.__keywordInput = input;
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    input.value = '坚持';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '坚持', isComposing: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', isComposing: true, keyCode: 229 }));
    // Some browsers may emit submit while composition is still active.
    document.querySelector('#custom-keyword-form').requestSubmit();
  });
  await expect(page.locator('#own-sentence')).toHaveCount(0);
  assert.ok(await page.evaluate(() => window.__keywordInput === document.activeElement));
  await page.locator('#custom-keyword').dispatchEvent('compositionend', { data: '坚持' });
  await page.locator('#custom-keyword').press('Enter');
  await expect(page.locator('#active-keyword')).toHaveText('坚持');
  await page.locator('#own-sentence').focus();
  await page.evaluate(() => {
    const input = document.querySelector('#own-sentence');
    window.__sentenceInput = input;
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = '我每天坚持练习写字。';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: input.value, isComposing: true }));
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: input.value }));
  });
  assert.ok(await page.evaluate(() => window.__sentenceInput === document.activeElement));
  await expect(page.locator('#own-sentence')).toHaveValue('我每天坚持练习写字。');
});

test('mode and per-keyword drafts, scenarios and self-checks survive switching, navigation and reload', async (t) => {
  const page = await fixture(t);
  await page.locator('#own-sentence').fill('我和同学一起解决班上的问题。');
  await page.locator('#sentence-context').selectOption('帮助同学时');
  await page.locator('#sentence-selfcheck').check();
  await chooseCustom(page, '坚持');
  await page.locator('#own-sentence').fill('我每天坚持练习写字。');
  await page.locator('#sentence-context').selectOption('你自己想到的情境');
  await page.locator('#custom-sentence-context').fill('练习书法');
  await page.locator('#sentence-selfcheck').check();
  await chooseCustom(page, '勇敢');
  await page.locator('#own-sentence').fill('我勇敢地走上台演讲。');
  await chooseCustom(page, '坚持');
  await expect(page.locator('#own-sentence')).toHaveValue('我每天坚持练习写字。');
  await expect(page.locator('#custom-sentence-context')).toHaveValue('练习书法');
  await expect(page.locator('#sentence-selfcheck')).toBeChecked();
  await page.locator('[data-keyword-mode="builtin"]').click();
  await expect(page.locator('#active-keyword')).toHaveText('解决');
  await expect(page.locator('#own-sentence')).toHaveValue('我和同学一起解决班上的问题。');
  await expect(page.locator('#sentence-context')).toHaveValue('帮助同学时');
  await expect(page.locator('#sentence-selfcheck')).toBeChecked();
  await page.locator('[data-keyword-mode="custom"]').click();
  await page.locator('nav a[href="#library"]:visible').first().click();
  await page.locator('#word-search').waitFor();
  await page.locator('[data-navigation-back]').click();
  await expect(page.locator('#active-keyword')).toHaveText('坚持');
  await page.reload();
  await expect(page.locator('#active-keyword')).toHaveText('坚持');
  await expect(page.locator('#custom-keyword')).toHaveValue('坚持');
  await expect(page.locator('#own-sentence')).toHaveValue('我每天坚持练习写字。');
  await expect(page.locator('#custom-sentence-context')).toHaveValue('练习书法');
  await expect(page.locator('#sentence-selfcheck')).toBeChecked();
});

test('missing-target reminder keeps student writing; custom completion does not credit an unrelated built-in word', async (t) => {
  const page = await fixture(t);
  await chooseCustom(page, '坚持');
  await page.locator('#own-sentence').fill('我每天努力练习写字。');
  await page.locator('#sentence-selfcheck').check();
  await page.locator('#submit-sentence').click();
  await expect(page.locator('#activity-feedback')).toContainText('你的句子还没有用到“坚持”');
  await expect(page.locator('#own-sentence')).toHaveValue('我每天努力练习写字。');
  await page.locator('#get-hint').click();
  await expect(page.locator('#hint-output')).toContainText('坚持');
  assert.ok(!(await page.locator('#hint-output').textContent()).includes('解决'));
  const before = await page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    return JSON.stringify({ records: state.records, xp: state.xp });
  });
  await page.locator('#own-sentence').fill('我每天坚持练习写字，希望写得更好。');
  await page.locator('#submit-sentence').click();
  await expect(page.locator('#activity-complete')).toBeVisible();
  await expect(page.locator('#activity-complete .self-assess')).toHaveCount(0);
  await expect(page.locator('#activity-feedback')).not.toContainText('还没有用到');
  assert.equal(await page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    return JSON.stringify({ records: state.records, xp: state.xp });
  }), before);
});

test('all five AI actions use the displayed target in both modes and preserve the draft', async (t) => {
  const page = await fixture(t);
  const sent = [];
  await page.route('**/api/gemini', async (route) => {
    const input = route.request().postDataJSON(); sent.push(input);
    const data = resultFor(input.action, input.context, word, true);
    await route.fulfill({ json: { ok: true, action: input.action, data } });
  });
  for (const keyword of ['解决', '坚持', '勇敢', '保护环境', '兴高采烈', '因为……所以……']) {
    if (keyword !== '解决') await chooseCustom(page, keyword);
    const text = `老师请我用“${keyword}”写一个完整的句子。`;
    await page.locator('#own-sentence').fill(text);
    for (const action of activityTutorActions[B.SENTENCE]) {
      await page.locator(`[data-ai-action="${action}"]`).click();
      await page.locator('.ai-result[aria-busy="false"] h3').filter({ hasText: '轮到你了' }).waitFor();
      assert.equal(sent.at(-1).context.topic, keyword);
      assert.equal(sent.at(-1).context.studentSentence, text);
      await page.locator('#modal [data-close-modal]').click();
      await expect(page.locator('#own-sentence')).toHaveValue(text);
    }
  }
  assert.equal(sent.length, 30); // One handler per action, even after repeated mode changes.
});

test('invalid Gemini models are hidden, automatic correction is bounded, and manual retry remains available', async (t) => {
  const page = await fixture(t);
  await chooseCustom(page, '保护环境');
  await page.locator('#own-sentence').fill('我们应该爱护大自然。');
  let providerCalls = 0, browserCalls = 0;
  const endpoint = createTeacherHandler({ env: { GEMINI_API_KEY: 'mock-only' }, logger: { info() {}, warn() {} }, generate: async (input) => {
    providerCalls++;
    const data = resultFor(input.action, input.context);
    data.example = providerCalls <= 2 ? '我们应该爱护大自然。' : '我们减少使用塑料袋，一起保护环境。';
    return JSON.stringify(data);
  } });
  await page.route('**/api/gemini', async (route) => {
    browserCalls++;
    const response = await endpoint(new Request(route.request().url(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: route.request().postData() }));
    await route.fulfill({ status: response.status, json: await response.json() });
  });
  await page.locator(`[data-ai-action="${A.SENTENCE_VIVID}"]`).click();
  await expect(page.locator('#modal [role="alert"]')).toContainText('指定词语');
  assert.equal(providerCalls, 2); assert.equal(browserCalls, 1);
  await expect(page.locator('.ai-result')).not.toContainText('我们应该爱护大自然。');
  await page.locator('[data-ai-retry]').click();
  await expect(page.locator('.ai-result')).toContainText('我们减少使用塑料袋，一起保护环境。');
  assert.equal(providerCalls, 3); assert.equal(browserCalls, 2);
  await page.locator('#modal [data-close-modal]').click();
  await expect(page.locator('#own-sentence')).toHaveValue('我们应该爱护大自然。');
});

test('target change cancels a pending teacher response and separates suggestions', async (t) => {
  const page = await fixture(t);
  await chooseCustom(page, '坚持');
  await page.locator('#own-sentence').fill('我每天坚持练习。');
  await page.evaluate(async () => {
    const { aiTeacher } = await import('/js/ai-teacher.js');
    aiTeacher.sentence_vivid = () => new Promise((resolve) => { window.__resolveOldTeacher = resolve; });
  });
  await page.locator(`[data-ai-action="${A.SENTENCE_VIVID}"]`).click();
  // Trigger a mode change programmatically while the native dialog is modal.
  await page.evaluate(() => document.querySelector('[data-keyword-mode="builtin"]').click());
  await expect(page.locator('#modal')).not.toBeVisible();
  await page.evaluate(() => window.__resolveOldTeacher({ example: '我每天坚持练习。' }));
  await expect(page.locator('#active-keyword')).toHaveText('解决');
  await expect(page.locator('#modal')).not.toBeVisible();
});

test('custom input, long target, workspace and teacher controls fit phone, tablet and desktop orientations', async (t) => {
  const page = await fixture(t);
  const keyword = '保护环境从身边的小事做起让我们的校园更加美丽'.repeat(3);
  await chooseCustom(page, keyword);
  for (const [width, height] of [[320,740],[844,390],[768,1024],[1024,768],[1366,900]]) {
    await page.setViewportSize({ width, height });
    for (const selector of ['.keyword-mode-options','#custom-keyword','#active-keyword','#own-sentence','.ai-actions']) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box.width > 0 && box.x >= 0 && box.x + box.width <= width + 1, `${selector} at ${width}x${height}`);
    }
    for (const button of await page.locator('[data-keyword-mode], #custom-keyword-form button, [data-ai-action]').all()) {
      const box = await button.boundingBox();
      assert.ok(box.height >= 44 && box.x + box.width <= width + 1);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: fileURLToPath(new URL(`keyword-${width}x${height}.png`, output)), fullPage: true });
  }
});

test('built-in block drafts and active target return after custom practice', async (t) => {
  const page = await fixture(t);
  const builtin = await page.evaluate(async () => {
    const { vocabulary } = await import('/js/state.js');
    const { builders } = await import('/data/content.js');
    const item = vocabulary.find((item) => builders[item.word]);
    return { id: item.id, word: item.word };
  });
  await page.goto(`${base}#activity/builder?word=${encodeURIComponent(builtin.id)}`);
  for (const key of ['when', 'who', 'event', 'action'])
    await page.locator(`[data-part="${key}:0"]`).click();
  const text = await page.locator('.sentence-display').textContent();
  await chooseCustom(page, '勇敢');
  await page.locator('#own-sentence').fill('我勇敢地走上台演讲。');
  await page.locator('[data-keyword-mode="builtin"]').click();
  await expect(page.locator('#active-keyword')).toHaveText(builtin.word);
  await expect(page.locator('.sentence-display')).toHaveText(text);
  await expect(page.locator('[data-part][aria-pressed="true"]')).toHaveCount(4);
});

test('custom length limit is enforced and naturalness feedback stays separate from target presence', async (t) => {
  const page = await fixture(t);
  await page.locator('[data-keyword-mode="custom"]').click();
  await expect(page.locator('#custom-keyword')).toHaveAttribute('maxlength', '80');
  await page.locator('#custom-keyword').evaluate((input) => { input.value = '词'.repeat(81); });
  await page.locator('#custom-keyword-form button').click();
  await expect(page.locator('#custom-keyword-error')).toContainText('80');
  await chooseCustom(page, '保护环境');
  await page.locator('#own-sentence').fill('我很保护环境。');
  await page.route('**/api/gemini', async (route) => {
    const input = route.request().postDataJSON();
    const data = resultFor(input.action, input.context);
    data.status = 'needs_revision';
    data.issues = [{ category: 'grammar', severity: 'error', text: '“很”不能这样修饰这个动作。', explanation: '可以写清楚自己怎样行动。' }];
    data.suggestedRevision = '我减少使用塑料袋，努力保护环境。';
    await route.fulfill({ json: { ok: true, action: input.action, data } });
  });
  await page.locator(`[data-ai-action="${A.SENTENCE_CHECK}"]`).click();
  await expect(page.locator('.ai-result')).toContainText('“很”不能这样修饰这个动作。');
  await expect(page.locator('#modal')).not.toContainText('还没有用到');
  await expect(page.locator('.ai-result')).toContainText('努力保护环境');
  await page.locator('#modal [data-close-modal]').click();
  await expect(page.locator('#own-sentence')).toHaveValue('我很保护环境。');
});
