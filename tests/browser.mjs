import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { activities } from '../data/activities.js';
import { sentenceChunks, paragraphs, practiceExample } from '../data/content.js';
const base = process.env.TEST_URL || 'http://localhost:4173/';
const output = new URL('../test-results/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.BROWSER_CHANNEL
    ? { channel: process.env.BROWSER_CHANNEL }
    : process.platform === 'win32'
      ? { channel: 'msedge' }
      : {}),
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  locale: 'zh-CN',
  hasTouch: true,
});
const page = await context.newPage(),
  errors = [],
  results = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
const source = JSON.parse(
  await readFile(new URL('../data/vocabulary.json', import.meta.url), 'utf8'),
).map((w) => ({ ...w, example: w.exampleSentence }));
async function go(hash) {
  await page.goto(base + '#' + hash);
  await page.locator('#main').waitFor();
  await page.locator('.loading').waitFor({ state: 'detached' });
}
async function done() {
  await page.locator('#activity-complete:not([hidden])').waitFor();
}
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log('PASS', name);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.error('FAIL', name, error.message);
    await page
      .screenshot({
        path: fileURLToPath(new URL(`failure-${results.length}.png`, output)),
        fullPage: true,
      })
      .catch(() => {});
  }
}
async function overflow() {
  return page.evaluate(() => ({
    width: innerWidth,
    body: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('#main *')]
      .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 5)
      .map((el) => el.className),
  }));
}
async function grade(value) {
  await go('library');
  await page.locator('[data-setting="grade"]').selectOption(value);
}
async function difficulty(value) {
  await go('settings');
  await page.locator('[data-setting="difficulty"]').selectOption(value);
}
try {
  await test('Dashboard loads without errors and has every configured activity link', async () => {
    await go('home');
    assert.equal(await page.locator('h1').textContent(), '今天，让词语长成故事。');
    await go('activities');
    assert.equal(await page.locator('.activity-card').count(), activities.length);
  });
  await test('Requested viewport sizes have no horizontal overflow', async () => {
    for (const [width, height] of [
      [320, 740],
      [375, 812],
      [430, 932],
      [768, 1024],
      [1024, 768],
      [1366, 900],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width, height });
      await go('home');
      const info = await overflow();
      assert.ok(info.body <= width + 1, JSON.stringify(info));
      await page.screenshot({
        path: fileURLToPath(new URL(`home-${width}.png`, output)),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 375, height: 812 });
  });
  await test('Grade and lesson filters isolate source data', async () => {
    await grade('4');
    await page.locator('[data-setting="lesson"]').selectOption('2');
    const expectedLessonWords = source.filter((word) => word.grade === 4 && String(word.lesson) === '2').length;
    assert.ok((await page.locator('#word-count').textContent()).startsWith(`${expectedLessonWords} `));
    const labels = await page.locator('.word-card .source-label').allTextContents();
    assert.ok(labels.every((x) => x.includes('四年级') && x.includes('第2课')));
    await page.reload();
    assert.equal(await page.locator('[data-setting="lesson"]').inputValue(), '2');
    await grade('3');
    const gradeThreeWords = source.filter((word) => word.grade === 3).length;
    assert.equal(await page.locator('[data-setting="lesson"]').isDisabled(), !source.some((word) => word.grade === 3 && word.lesson));
    assert.ok((await page.locator('#word-count').textContent()).startsWith(`${gradeThreeWords} `));
  });
  await test('Every activity screen renders for both grades at 320px', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    for (const g of ['3', '4']) {
      await grade(g);
      for (const a of activities) {
        await go(`activity/${a.id}`);
        const text = await page.locator('#main').innerText();
        assert.ok(!/undefined|NaN|暂时无法显示|找不到这项/.test(text), `${g}/${a.id}`);
        assert.ok((await page.locator('#activity-body').innerText()).length > 20, `${g}/${a.id}`);
        const o = await overflow();
        assert.ok(o.body <= 321, `${g}/${a.id}: ${JSON.stringify(o)}`);
      }
    }
    await grade('3');
  });
  await test('Empty activity selections can recover with the full vocabulary library', async () => {
    await go('library');
    await page.evaluate(() => {
      const key = 'huawen-lab-v1';
      const saved = JSON.parse(localStorage.getItem(key)) || { version: 1, settings: {} };
      Object.assign(saved.settings, { grade: '4', category: 'unavailable-filter' });
      localStorage.setItem(key, JSON.stringify(saved));
    });
    await page.reload();
    await page.locator('.loading').waitFor({ state: 'detached' });
    await go('activity/recognition');
    await page.locator('[data-reset-vocabulary-selection]').click();
    assert.equal(await page.locator('[data-setting="grade"]').count(), 0);
    assert.ok((await page.locator('#activity-body').innerText()).length > 20);
    await grade('3');
  });
  await test('Recognition allows retry, multi-select and records mistakes', async () => {
    await go('activity/recognition?word=3-巨-巨大');
    const buttons = page.locator('[data-choice]');
    const texts = await buttons.allTextContents();
    const wrong = texts.find((t) => !t.includes('巨'));
    await page.locator('#activity-body').getByRole('button', { name: wrong, exact: true }).tap();
    assert.ok((await page.locator('#activity-feedback').textContent()).includes('再想一想'));
    for (const word of texts.filter((t) => t.includes('巨')))
      await page.locator('#activity-body').getByRole('button', { name: word, exact: true }).tap();
    await done();
    await go('weak');
    assert.ok((await page.locator('#main').innerText()).includes('巨大'));
  });
  await test('Word cards open, favorite and add to writing; dialog is keyboard dismissible', async () => {
    await go('library');
    await page.locator('[data-word-card="3-巨-巨大"]').click();
    await page.locator('#modal').waitFor({ state: 'visible' });
    await page.locator('#favorite-word').click();
    await page.locator('#tray-word').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#modal').isVisible(), false);
    await page.locator('#favorites-only').click();
    assert.ok((await page.locator('#word-grid').innerText()).includes('巨大'));
  });
  await test('Matching supports mouse drag and tap-to-tap on a touch viewport', async () => {
    await page.setViewportSize({ width: 430, height: 932 });
    await go('activity/matching?word=3-巨-巨大');
    const card = page.locator('[data-word]').first();
    const word = await card.textContent();
    const chars = await page
      .locator('[data-target]')
      .evaluateAll((els) => els.map((el) => el.dataset.target));
    const char = chars.find((c) => word.includes(c));
    const from = await card.boundingBox(),
      to = await page.locator(`[data-target="${char}"]`).boundingBox();
    const beforeDrag = await page.locator('[data-word]').count();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + 30, { steps: 12 });
    await page.mouse.up();
    assert.equal(await page.locator('[data-word]').count(), beforeDrag - 1);
    while (await page.locator('[data-word]').count()) {
      const b = page.locator('[data-word]').first(),
        text = await b.textContent();
      const target = chars.find((c) => text.includes(c));
      await b.tap();
      await page.locator(`[data-target="${target}"]`).tap();
    }
    await done();
  });
  await test('Context cloze accepts choices and typed punctuation/spacing variations', async () => {
    await difficulty('easy');
    await go('activity/cloze?word=3-巨-巨大');
    await page.locator('[data-answer="巨大"]').click();
    await done();
    await difficulty('hard');
    await go('activity/cloze?word=3-巨-巨大');
    assert.equal(await page.locator('[data-answer]').count(), 0);
    await page.locator('#cloze-answer').fill(' 巨 大！ ');
    await page.locator('#cloze-answer').press('Enter');
    await done();
    await difficulty('easy');
  });
  await test('Sentence puzzle reconstructs the source using phrase tiles', async () => {
    await go('activity/puzzle?word=3-疑-疑问');
    for (const tile of sentenceChunks(source.find((w) => w.id === '3-疑-疑问')))
      await page.locator('[data-add]').filter({ hasText: tile }).click();
    await page.locator('#check-order').click();
    await done();
  });
  await test('Sentence Builder accepts two distinct curated combinations', async () => {
    for (const indices of [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
    ]) {
      await go('activity/builder?word=3-解-解决');
      for (const [k, i] of ['when', 'who', 'event', 'action'].map((k, i) => [k, indices[i]]))
        await page.locator(`[data-part="${k}:${i}"]`).click();
      await page.locator('#finish-builder').click();
      await done();
    }
  });
  await test('Independent sentence writing saves drafts and records practice honestly', async () => {
    await go('activity/builder?word=3-解-解决&mode=free');
    await page.locator('#own-sentence').fill('我和同学认真讨论，终于解决了班级图书摆放的问题。');
    await page.locator('#sentence-selfcheck').check();
    await page.locator('#submit-sentence').click();
    await done();
    assert.ok((await page.locator('#activity-feedback').innerText()).includes('练习'));
    await page.reload();
    assert.ok((await page.locator('#own-sentence').inputValue()).includes('图书摆放'));
  });
  await test('Sentence expansion adds and removes useful detail', async () => {
    await go('activity/expansion?word=3-浮-漂浮');
    await page.locator('[data-expand="time:0"]').click();
    await page.locator('[data-expand="place:0"]').click();
    await page.locator('#finish-expansion').click();
    await done();
  });
  await test('Sentence Doctor identifies and repairs an unambiguous repeated word', async () => {
    await go('activity/doctor?word=3-尽-尽力');
    await page.locator('[data-part="1"]').click();
    await page.locator('#corrected-sentence').fill('我会尽力完成这次任务。');
    await page.locator('#check-doctor').click();
    await done();
  });
  await test('Paragraph ordering follows the authored narrative sequence', async () => {
    await go('activity/paragraph?word=3-突-突然');
    const title = await page.locator('#activity-body h2').textContent();
    const story = paragraphs.find((p) => p.title === title);
    assert.ok(story);
    for (const line of story.sentences)
      await page.locator('[data-add]').filter({ hasText: line }).click();
    await page.locator('#check-order').click();
    await done();
  });
  await test('Writing planner, draft restore, checks, target highlighting and submission', async () => {
    await go('activity/essay?word=3-解-解决');
    await page.locator('#planner-details > summary').click();
    await page.locator('[data-plan="time"]').fill('星期六早上');
    await page.locator('[data-plan="place"]').fill('学校图书馆');
    const text =
      '星期六早上，我和同学来到学校图书馆，发现书架上的书摆得很乱。\n我们先把图书分类，然后把书整齐地放好。遇到不知道怎样摆放的书，我们便一起讨论，终于解决了问题。\n看着整齐的书架，我很开心，也明白了合作的重要。';
    await page.locator('#essay-text').fill(text);
    await page.locator('#check-writing').click();
    assert.ok((await page.locator('#writing-report').innerText()).includes('自动检查'));
    assert.ok((await page.locator('#writing-preview mark').allTextContents()).includes('解决'));
    await page.reload();
    assert.equal(await page.locator('#essay-text').inputValue(), text);
    assert.equal(await page.locator('[data-plan="time"]').inputValue(), '星期六早上');
    await page.locator('#check-natural').check();
    await page.locator('#finish-writing').click();
    await done();
  });
  await test('Temporary vocabulary helper returns to the exact essay and story drafts', async () => {
    await go('activity/essay?word=3-è§£-è§£å†³');
    const previousEssayDraft = await page.locator('#essay-text').inputValue();
    const essayDraft = 'æ´»åŠ¨è¿”å›žè‰ç¨¿ï¼šæˆ‘æŠŠè§£å†³é—®é¢˜çš„æ–¹æ³•è®°ä¸‹æ¥ã€‚';
    await page.locator('#essay-text').fill(essayDraft);
    await page.locator('[data-word-card]').first().click();
    await page.locator('#modal a[data-open-helper]').click();
    await page.locator('[data-navigation-back]').waitFor();
    assert.equal(await page.locator('[data-navigation-back]').count(), 1);
    await page.locator('[data-navigation-back]').click();
    await page.locator('#essay-text').waitFor();
    assert.equal(await page.locator('#essay-text').inputValue(), essayDraft);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.locator('#essay-text').fill(previousEssayDraft);

    await page.setViewportSize({ width: 1366, height: 900 });
    await go('activity/story?word=3-è§£-è§£å†³');
    const storyLine = 'Story helper draft!';
    await page.locator('#next-story').fill(storyLine);
    await page.locator('#append-story').click();
    await page.locator('[data-word-card]').first().click();
    await page.locator('#modal a[data-open-helper]').click();
    await page.locator('[data-navigation-back]').click();
    assert.ok((await page.locator('#activity-body').innerText()).includes(storyLine));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  });
  await test('Browser Back and direct library visits do not leave stale activity returns', async () => {
    await go('activity/essay?word=3-è§£-è§£å†³');
    await page.locator('[data-word-card]').first().click();
    await page.locator('#modal a[data-open-helper]').click();
    await page.goBack();
    await page.locator('#essay-text').waitFor();
    await go('library');
    assert.equal(await page.locator('.page-back-bar .small').count(), 0);
  });
  await test('Teacher can review saved writing and configure a Year 4 lesson activity', async () => {
    await go('teacher');
    await page.locator('[data-review-draft]').first().click();
    if (await page.locator('[data-approved-word]').count()) {
      await page.locator('[data-approved-word]').first().check();
      await page.locator('#confirm-teacher-review').click();
    } else await page.keyboard.press('Escape');
    await page.locator('[data-setting="grade"]').selectOption('4');
    await page.locator('[data-setting="lesson"]').selectOption('2');
    await page.locator('#teacher-count').selectOption('10');
    await page.locator('#teacher-difficulty').selectOption('medium');
    await page.locator('#start-teacher').click();
    await page.locator('#activity-body').waitFor();
    assert.ok((await page.locator('.activity-title-row').innerText()).includes('第2课'));
  });
  await test('Main screens remain usable after landscape/portrait resizing', async () => {
    for (const hash of [
      'home',
      'activities',
      'library',
      'review',
      'weak',
      'stats',
      'teacher',
      'settings',
    ]) {
      for (const [width, height] of [
        [1024, 768],
        [768, 1024],
        [375, 812],
      ]) {
        await page.setViewportSize({ width, height });
        await go(hash);
        assert.ok((await overflow()).body <= width + 1, hash);
      }
    }
  });
  await test('Activity reset preserves XP and saved writing; full reset requires confirmation', async () => {
    await grade('3');
    await go('stats');
    const before = await page.locator('.header-actions').innerText();
    await go('activity/recognition?word=3-巨-巨大');
    await page.locator('#reset-activity').click();
    await page.locator('#accept-confirm').click();
    assert.equal(await page.locator('.header-actions').innerText(), before);
    await go('activity/essay?word=3-解-解决');
    assert.ok((await page.locator('#essay-text').inputValue()).includes('图书馆'));
    await go('settings');
    await page.locator('#reset-progress').click();
    await page.locator('#cancel-confirm').click();
    await go('stats');
    assert.equal(await page.locator('.header-actions').innerText(), before);
  });
  await test('Offline cache can reload the dashboard and a core activity', async () => {
    await go('home');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.locator('#main').waitFor();
    await context.setOffline(true);
    try {
      await page.reload();
      await page.locator('#main').waitFor();
      await page.locator('.bottom-nav a[href="#activities"]').click();
      await page.locator('a[href="#activity/recognition"]').click();
      await page.locator('#activity-body').waitFor();
      assert.ok((await page.locator('#activity-body').innerText()).includes('找出'));
    } finally {
      await context.setOffline(false);
    }
  });
  await test('Full learning reset clears app progress and drafts', async () => {
    await go('settings');
    await page.locator('#reset-progress').click();
    await page.locator('#accept-confirm').click();
    await page.locator('h1').waitFor();
    assert.ok((await page.locator('.header-actions').innerText()).includes('0 XP'));
    await go('teacher');
    assert.equal(await page.locator('[data-review-draft]').count(), 0);
    await go('weak');
    assert.ok((await page.locator('#main').innerText()).includes('暂时没有'));
  });
  await test('No browser JavaScript errors', async () => assert.deepEqual(errors, []));
} finally {
  await writeFile(
    new URL('browser-report.json', output),
    JSON.stringify({ results, errors }, null, 2),
  );
  await browser.close();
}
if (results.some((r) => !r.passed)) process.exitCode = 1;
