import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

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
