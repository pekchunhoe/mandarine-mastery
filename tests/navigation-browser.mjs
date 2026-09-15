import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { activities } from '../data/activities.js';

const base = process.env.TEST_URL || 'http://localhost:4173/';
let browser;
before(async () => {
  browser = await chromium.launch({ headless: true,
    ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : process.platform === 'win32' ? { channel: 'msedge' } : {}),
  });
});
after(async () => browser?.close());

async function fixture(t, route = 'home', denyStorage = false) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
  t.after(() => context.close());
  if (denyStorage) await context.addInitScript(() => {
    for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { throw new Error('Storage denied'); } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(`${base}#${route}`);
  await page.locator('[data-navigation-back]').waitFor();
  return page;
}
async function at(page, route) {
  await page.waitForFunction((route) => decodeURI(location.hash) === `#${route}`, route);
  await page.locator('[data-navigation-back]').waitFor();
}
async function visit(page, route) {
  await page.evaluate((route) => { location.hash = route; }, route);
  await at(page, route);
  // Rendering happens in the native event task after location.hash is updated.
  await page.waitForFunction(() => !document.querySelector('[data-navigation-back]')?.disabled);
}
async function back(page, route) {
  await page.locator('[data-navigation-back]').click();
  await at(page, route);
}
const draft = '今天学校举办运动会，我和同学一起参加比赛。\n\n我们互相鼓励，一起努力。';

test('root, direct route and unknown route have safe semantic Back buttons', async (t) => {
  for (const route of ['home', 'activity/essay', 'activity/missing', 'missing']) {
    const page = await fixture(t, route);
    assert.equal(await page.locator('[data-navigation-back]').count(), 1);
    assert.equal(await page.locator('[data-navigation-back]').isDisabled(), true);
    assert.equal(await page.locator('[data-navigation-back]').textContent(), '← 返回');
  }
});

test('five routes unwind exactly once per click and browser Forward works', async (t) => {
  const page = await fixture(t);
  for (const route of ['activities', 'activity/guidedEssay', 'activity/story', 'library']) await visit(page, route);
  for (const route of ['activity/story', 'activity/guidedEssay', 'activities', 'home']) await back(page, route);
  assert.equal(await page.locator('[data-navigation-back]').isDisabled(), true);
  await page.goForward(); await at(page, 'activities');
  await back(page, 'home');
});

test('Back then new navigation replaces the old forward branch', async (t) => {
  const page = await fixture(t);
  await visit(page, 'activities'); await visit(page, 'library');
  await back(page, 'activities'); await visit(page, 'stats');
  await back(page, 'activities');
  await page.goForward(); await at(page, 'stats');
  await back(page, 'activities'); await back(page, 'home');
});

test('teacher redraw and full-route vocabulary management use one-step Back', async (t) => {
  const page = await fixture(t);
  await visit(page, 'teacher');
  await page.locator('#projection-toggle').click();
  assert.equal(await page.locator('[data-navigation-back]').count(), 1);
  await back(page, 'home');
  await visit(page, 'library'); await visit(page, 'vocabulary-admin');
  await back(page, 'library');
});

test('normal activity visits apply changed settings while Back preserves the previous attempt', async (t) => {
  const page = await fixture(t, 'activity/cloze?word=3-巨-巨大');
  const answers = await page.locator('[data-answer]').allTextContents();
  await visit(page, 'settings');
  await page.locator('[data-setting="difficulty"]').selectOption('hard');
  await visit(page, 'activity/cloze?word=3-巨-巨大');
  await page.locator('#cloze-answer').fill('我的答案');
  await back(page, 'settings'); await back(page, 'activity/cloze?word=3-巨-巨大');
  assert.deepEqual(await page.locator('[data-answer]').allTextContents(), answers);
  await page.goForward(); await at(page, 'settings');
  await page.goForward(); await at(page, 'activity/cloze?word=3-巨-巨大');
  assert.equal(await page.locator('#cloze-answer').inputValue(), '我的答案');
});

test('explicit progress reset does not revive cached student work', async (t) => {
  const page = await fixture(t, 'activity/essay');
  await page.locator('#essay-text').fill(draft);
  await visit(page, 'settings');
  await page.locator('#reset-progress').click();
  await page.locator('#accept-confirm').click();
  await at(page, 'home');
  await back(page, 'settings'); await back(page, 'activity/essay');
  assert.equal(await page.locator('#essay-text').inputValue(), '');
});

test('activity menu jumps directly and becomes one real history entry', async (t) => {
  const page = await fixture(t);
  await visit(page, 'activities'); await visit(page, 'activity/guidedEssay'); await visit(page, 'activity/story');
  await page.locator('.side-nav a[href="#activities"]').click();
  await at(page, 'activities');
  await back(page, 'activity/story'); await back(page, 'activity/guidedEssay');
});

test('same-route clicks, settings rerenders and autosave add no history', async (t) => {
  const page = await fixture(t);
  await visit(page, 'library');
  for (let i = 0; i < 3; i++) await page.locator('.side-nav a[href="#library"]').click();
  await page.locator('[data-setting="grade"]').selectOption('3');
  await back(page, 'home');
  assert.equal(await page.locator('[data-navigation-back]').isDisabled(), true);
  await visit(page, 'activity/essay');
  await page.locator('#essay-text').fill(draft);
  await back(page, 'home');
});

test('guided essay preserves paragraphs, counts, current point, hints and checklist', async (t) => {
  const page = await fixture(t);
  await visit(page, 'activities'); await visit(page, 'activity/guidedEssay');
  await page.locator('#guided-line').fill(draft);
  await page.locator('#guided-more-help').click();
  await page.locator('[data-guided-paragraph="1"]').click();
  await page.locator('#guided-line').fill('比赛结束后，我们一起收拾场地。');
  await page.locator('#guided-more-help').click();
  await page.locator('#guided-check-1').check();
  const preview = await page.locator('#guided-preview').textContent();
  const count = await page.locator('#guided-total-count').textContent();
  const hint = await page.locator('.guided-help').innerText();
  await visit(page, 'activity/story');
  await back(page, 'activity/guidedEssay');
  assert.equal(await page.locator('[data-guided-paragraph="1"]').getAttribute('aria-current'), 'step');
  assert.equal(await page.locator('#guided-line').inputValue(), '比赛结束后，我们一起收拾场地。');
  assert.equal(await page.locator('#guided-preview').textContent(), preview);
  assert.equal(await page.locator('#guided-total-count').textContent(), count);
  assert.equal(await page.locator('.guided-help').innerText(), hint);
  assert.equal(await page.locator('#guided-check-1').isChecked(), true);
  await page.locator('[data-guided-paragraph="0"]').click();
  assert.equal(await page.locator('#guided-line').inputValue(), draft);
  await page.reload();
  assert.equal(await page.locator('#guided-line').inputValue(), draft);
  assert.equal(await page.locator('#guided-preview').textContent(), preview);
  assert.equal(await page.locator('[data-navigation-back]').isDisabled(), true);
});

test('essay and Story Chain drafts survive helper Back, browser traversal and reload', async (t) => {
  const page = await fixture(t, 'activity/essay');
  await page.locator('#essay-text').fill(draft);
  await page.locator('[data-select-word]').first().click();
  const selected = await page.locator('.selected-words').textContent();
  const metrics = await page.locator('#writing-metrics').textContent();
  await page.locator('[data-word-card]').first().click();
  await page.locator('#modal a[data-open-helper]').click();
  await at(page, 'library');
  await back(page, 'activity/essay');
  assert.equal(await page.locator('#essay-text').inputValue(), draft);
  assert.equal(await page.locator('.selected-words').textContent(), selected);
  assert.equal(await page.locator('#writing-metrics').textContent(), metrics);
  await visit(page, 'activity/story');
  await page.locator('#next-story').fill('我拿起书包，想找到失主。');
  await page.locator('#append-story').click();
  await page.locator('#next-story').fill('还没写完的一句。');
  await page.locator('#change-story-word').click();
  const content = await page.locator('#activity-body').innerText();
  await visit(page, 'library');
  await page.goBack(); await at(page, 'activity/story');
  assert.equal(await page.locator('#activity-body').innerText(), content);
  assert.equal(await page.locator('#next-story').inputValue(), '还没写完的一句。');
  await page.reload();
  assert.equal(await page.locator('#next-story').inputValue(), '还没写完的一句。');
  assert.ok((await page.locator('#activity-body').innerText()).includes('我拿起书包，想找到失主。'));
});

test('quiz choices, hint progress and answer handlers remain live after Back', async (t) => {
  const page = await fixture(t, 'activity/recognition');
  const character = await page.locator('.target-character').textContent();
  const correct = page.locator('[data-choice]').filter({ hasText: character });
  await correct.first().click();
  await page.locator('#get-hint').click();
  const collected = await page.locator('#collected').textContent();
  const hint = await page.locator('#hint-output').textContent();
  await visit(page, 'library'); await back(page, 'activity/recognition');
  assert.equal(await page.locator('#collected').textContent(), collected);
  assert.equal(await page.locator('#hint-output').textContent(), hint);
  for (const button of await correct.all()) if (!(await button.isDisabled())) await button.click();
  await page.locator('#activity-complete:not([hidden])').waitFor();
});

test('result screens retain their results after another route and Back', async (t) => {
  const page = await fixture(t, 'activity/recognition?word=3-巨-巨大');
  const character = await page.locator('.target-character').textContent();
  for (const button of await page.locator('[data-choice]').filter({ hasText: character }).all()) await button.click();
  await page.locator('#next-question').click();
  await page.locator('.summary-score').waitFor();
  const score = await page.locator('.summary-score').textContent();
  await visit(page, 'stats'); await back(page, 'activity/recognition?word=3-巨-巨大');
  assert.equal(await page.locator('.summary-score').textContent(), score);
});

test('dialogs, vocabulary search and pronunciation controls do not add page history', async (t) => {
  const page = await fixture(t);
  await visit(page, 'activity/guidedEssay');
  await page.locator('#guided-vocabulary').click();
  await page.locator('dialog[open]').waitFor();
  await page.keyboard.press('Escape');
  await back(page, 'home');
  assert.equal(await page.locator('[data-navigation-back]').isDisabled(), true);
});

test('rapid Back clicks enqueue a single traversal', async (t) => {
  const page = await fixture(t);
  await visit(page, 'activities'); await visit(page, 'library');
  await page.locator('[data-navigation-back]').evaluate((button) => {
    for (let i = 0; i < 12; i++) button.click();
  });
  await at(page, 'activities');
  await back(page, 'home');
});

test('storage denial preserves live drafts and safe navigation', async (t) => {
  const page = await fixture(t, 'activity/guidedEssay', true);
  await page.locator('#guided-line').fill(draft);
  await visit(page, 'activity/story'); await back(page, 'activity/guidedEssay');
  assert.equal(await page.locator('#guided-line').inputValue(), draft);
  assert.equal(await page.locator('[data-navigation-back]').isDisabled(), true);
});

test('refresh after multiple pages remains safe through native Back and Forward', async (t) => {
  const page = await fixture(t);
  await visit(page, 'activities'); await visit(page, 'activity/essay');
  await page.locator('#essay-text').fill(draft);
  await page.reload();
  assert.equal(await page.locator('#essay-text').inputValue(), draft);
  assert.equal(await page.locator('[data-navigation-back]').isDisabled(), true);
  await page.goBack(); await at(page, 'activities');
  assert.equal(await page.locator('[data-navigation-back]').isDisabled(), true);
  await page.goForward(); await at(page, 'activity/essay');
  assert.equal(await page.locator('#essay-text').inputValue(), draft);
  await visit(page, 'library'); await back(page, 'activity/essay');
  assert.equal(await page.locator('[data-navigation-back]').isDisabled(), true);
});

test('timed sessions pause while visiting a helper and resume on Back', async (t) => {
  const page = await fixture(t, 'activity/timed');
  const seconds = async () => Number((await page.locator('#session-timer').textContent()).match(/\d+/)[0]);
  const before = await seconds();
  await visit(page, 'library');
  await page.waitForTimeout(1300);
  await back(page, 'activity/timed');
  await page.waitForTimeout(250);
  const resumed = await seconds();
  assert.ok(resumed >= before - 1);
  await page.waitForTimeout(1200);
  assert.ok(await seconds() < resumed);
});

test('Back restores previous scroll position', async (t) => {
  const page = await fixture(t);
  await visit(page, 'library');
  await page.evaluate(() => scrollTo(0, 600));
  await page.waitForFunction(() => scrollY >= 590);
  await visit(page, 'activity/story'); await back(page, 'library');
  await page.waitForFunction(() => Math.abs(scrollY - 600) < 5);
});

test('all activity toolbars are semantic, touch friendly and fit requested viewport sizes', async (t) => {
  const page = await fixture(t);
  const sizes = [[320,740],[360,800],[375,812],[390,844],[412,915],[430,932],[740,360],[844,390],[768,1024],[1024,768],[1366,900]];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const id of (width === 320 ? activities.map((activity) => activity.id) : ['guidedEssay', 'story', 'timed'])) {
      await visit(page, `activity/${id}`);
      const button = page.locator('[data-navigation-back]');
      assert.equal(await button.count(), 1);
      const box = await button.boundingBox();
      assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= width, `${id}: ${width}`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${id}: overflow at ${width}`);
      assert.equal(await button.evaluate((el) => el.tagName), 'BUTTON');
    }
  }
  await page.locator('[data-navigation-back]').focus();
  assert.equal(await page.locator('[data-navigation-back]').evaluate((el) => document.activeElement === el), true);
  await page.keyboard.press('Enter');
  await page.locator('#main').waitFor();
});
