import { vocabularyService } from '../js/vocabulary-service.js';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { practiceExample, tagsFor } from '../data/content.js';
import { getEssayTitles } from '../js/essay-title-service.js';
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
  viewport: { width: 375, height: 812 },
  hasTouch: true,
  locale: 'zh-CN',
});
const page = await context.newPage(),
  results = [],
  errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const rows = JSON.parse(
  await readFile(new URL('../data/vocabulary.json', import.meta.url), 'utf8'),
);
vocabularyService.setWords(rows);
const source = vocabularyService.getAllWords();
async function go(hash) {
  await page.goto(base + '#' + hash);
  await page.locator('#main').waitFor();
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
        path: fileURLToPath(new URL(`extended-failure-${results.length}.png`, output)),
        fullPage: true,
      })
      .catch(() => {});
  }
}
async function grade(value) {
  await go('library');
  await page.locator('[data-setting="grade"]').selectOption(value);
}
try {
  await test('Memory cards match unique word–sentence pairs without ambiguous inclusion', async () => {
    await go('activity/memory?word=3-巨-巨大');
    const known = new Map();
    const n = await page.locator('[data-card]').count();
    assert.equal(n, 6);
    for (let i = 0; i < n; i += 2) {
      const a = page.locator(`[data-card="${i}"]`),
        b = page.locator(`[data-card="${i + 1}"]`);
      await a.tap();
      known.set(i, (await a.textContent()).replace(/^✓ /, ''));
      await b.tap();
      known.set(i + 1, (await b.textContent()).replace(/^✓ /, ''));
      await page.waitForFunction(
        () => document.querySelectorAll('.memory-card.flipped').length === 0,
      );
    }
    for (const [i, text] of known) {
      if (await page.locator(`[data-card="${i}"]`).isDisabled()) continue;
      const word = source.find((w) => w.word === text);
      if (!word) continue;
      const partner = [...known].find(([j, t]) => j !== i && t.includes(word.word));
      assert.ok(partner);
      await page.locator(`[data-card="${i}"]`).tap();
      await page.locator(`[data-card="${partner[0]}"]`).tap();
    }
    await done();
  });
  await test('Matching supports a genuine touch drag sequence', async () => {
    await page.setViewportSize({ width: 430, height: 932 });
    await go('activity/matching?word=3-巨-巨大');
    const first = page.locator('[data-word]').first(),
      text = await first.textContent();
    const targets = await page
      .locator('[data-target]')
      .evaluateAll((els) => els.map((el) => el.dataset.target));
    const target = targets.find((c) => text.includes(c));
    const from = await first.boundingBox(),
      to = await page.locator(`[data-target="${target}"]`).boundingBox();
    const beforeDrag = await page.locator('[data-word]').count();
    const client = await context.newCDPSession(page);
    const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const end = { x: to.x + to.width / 2, y: to.y + 30 };
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    for (let i = 1; i <= 10; i++)
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: start.x + ((end.x - start.x) * i) / 10, y: start.y + ((end.y - start.y) * i) / 10 },
        ],
      });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal(await page.locator('[data-word]').count(), beforeDrag - 1);
    await client.detach();
  });
  await test('Sentence tiles can be placed with keyboard only', async () => {
    await go('activity/puzzle?word=3-疑-疑问');
    for (let i = 0; i < 4; i++) {
      await page.locator(`[data-add="${i}"]`).focus();
      await page.keyboard.press('Enter');
    }
    await page.locator('#check-order').focus();
    await page.keyboard.press('Enter');
    await done();
  });
  await test('Context scenes require an explanation and semantic categories accept multiple tags', async () => {
    await grade('4');
    await go('activity/scene?word=4-沟-沟通');
    await page.locator('[data-scene="沟通"]').tap();
    await page.locator('#why-scene').fill('因为他们正在讨论问题，也在听对方的想法。');
    await page.locator('#finish-scene').tap();
    await done();
    await go('activity/classify?word=4-协-协助');
    await page.locator('[data-category="品德"]').tap();
    await done();
  });
  await test('Open classification and scene fallbacks remain honest, functioning exercises', async () => {
    await go('activity/classify?word=4-肝-肝脏');
    await page.locator('#open-category').selectOption('其他');
    await page.locator('#category-reason').fill('肝脏是身体里的器官。');
    await page.locator('#save-category').click();
    await done();
    await go('activity/scene?word=4-肝-肝脏');
    await page.locator('#scene-meaning').fill('这个词表示人体的一个器官。');
    await page.locator('#save-scene-reading').click();
    await done();
  });
  await test('One-word multiple contexts and relationship cards lead to sentence production', async () => {
    await go('activity/multi?word=4-沟-沟通');
    assert.equal(await page.locator('#activity-body .list-row').count(), 3);
    await page.locator('#own-sentence').fill('我们小组先耐心沟通，再决定怎样分工布置课室。');
    await page.locator('#sentence-selfcheck').check();
    await page.locator('#submit-sentence').click();
    await done();
    await go('activity/network?word=4-沟-沟通');
    assert.ok((await page.locator('.network').innerText()).includes('常见搭配'));
    await page.locator('#read-network').click();
    await done();
  });
  await test('Connector exercises explain causal and sequential usage', async () => {
    await go('activity/connectors');
    await page.locator('[data-connector="于是"]').click();
    await done();
    assert.ok((await page.locator('#activity-feedback').innerText()).includes('随后的行动'));
  });
  await test('Story chain creates four saved sentences and can finish a story', async () => {
    await go('activity/story');
    for (const line of [
      '我走到书包旁边，发现上面写着一个同学的名字。',
      '我想失主一定很着急，便请老师帮忙。',
      '老师通过广播寻找失主，终于有一个小男孩跑了过来。',
      '他拿回书包后连声道谢，我也高兴地笑了。',
    ]) {
      await page.locator('#next-story').fill(line);
      await page.locator('#append-story').click();
    }
    await page.locator('#finish-story').click();
    await done();
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#activity-body .story-line').length === 5);
    assert.equal(await page.locator('#activity-body .story-line').count(), 5);
  });
  await test('Treasure missions lead to an autosaved paragraph', async () => {
    await grade('3');
    await go('activity/treasure');
    const missionCount = await page.locator('[data-mission]').count();
    for (let i = 0; i < missionCount; i++) {
      await page.locator(`[data-mission="${i}"]`).click();
      const label = await page.locator(`[data-mission="${i}"]`).textContent();
      const wanted = Number(label.match(/找 (\d)/)?.[1] || 1);
      const candidates = await page.locator('[data-treasure]').allTextContents();
      const matching = candidates
        .filter((w) =>
          label.includes('动作')
            ? tagsFor(w).includes('动作')
            : label.includes('心情')
              ? tagsFor(w).includes('心情')
              : label.includes('帮助别人')
                ? source.some((x) => x.word === w && x.essayTopics.includes(getEssayTitles({ category: '帮助别人' })[0].title))
                : true,
        )
        .slice(0, wanted);
      for (const word of matching) {
        await page.locator(`[data-mission="${i}"]`).click();
        await page
          .locator('[data-treasure]')
          .filter({ hasText: new RegExp(`^${word}$`) })
          .click();
      }
    }
    await page
      .locator('#treasure-paragraph')
      .fill(
        '星期六，我们尽力帮助爷爷修理坏掉的椅子。看见椅子修好了，我激动地笑了，心里感到十分幸福。',
      );
    await page.locator('#finish-treasure').click();
    await done();
  });
  await test('Sentence and essay layouts are visually captured at phone and laptop widths', async () => {
    for (const width of [375, 1366]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await go('activity/builder?word=3-解-解决');
      await page.screenshot({
        path: fileURLToPath(new URL(`builder-${width}.png`, output)),
        fullPage: true,
      });
      await go('activity/essay?word=3-解-解决');
      await page.screenshot({
        path: fileURLToPath(new URL(`essay-${width}.png`, output)),
        fullPage: true,
      });
    }
  });
  await test('Model essay read-aloud has sentence highlights without phone-width overflow', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await go('activity/modelEssay');
    assert.ok(await page.locator('[data-essay-sentence]').count() > 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.locator('[data-speak-essay]').click();
    assert.equal(await page.locator('.essay-sentence--active').count(), 1);
    await page.screenshot({ path: fileURLToPath(new URL('model-essay-highlight-375.png', output)), fullPage: true });
  });
  await test('Daily route reuses vocabulary through all five stages', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await go('settings');
    await page.locator('#reset-progress').click();
    await page.locator('#accept-confirm').click();
    await go('activity/recognition?daily=1');
    for (let stage = 0; stage < 5; stage++)
      for (let question = 0; question < (stage === 4 ? 1 : 2); question++) {
        if (stage === 0) {
          const char = (await page.locator('.target-character').textContent()).trim();
          const options = await page.locator('[data-choice]').allTextContents();
          for (const word of options.filter((w) => w.includes(char)))
            await page
              .locator('[data-choice]')
              .filter({ hasText: new RegExp(`^${word}$`) })
              .click();
        } else if (stage === 1 || stage === 2) {
          if (await page.locator('#hide-reference').isVisible())
            await page.locator('#hide-reference').click();
          const blank = (
            await page.locator('#activity-body .sentence-display').textContent()
          ).replace(/\s/g, '');
          const word = source.find(
            (w) =>
              w.grade === 3 &&
              practiceExample(w).replaceAll(w.word, '？').replace(/\s/g, '') === blank,
          );
          assert.ok(word, blank);
          if (await page.locator('#cloze-answer').count()) {
            await page.locator('#cloze-answer').fill(word.word);
            await page.locator('#submit-cloze').click();
          } else await page.locator(`[data-answer="${word.word}"]`).click();
        } else if (stage === 3) {
          const target = (await page.locator('.target-word').textContent()).trim();
          const sentences = {
            巨石: '星期天，我和弟弟在山脚下发现一块长满青苔的巨石。',
            鲜艳: '雨过天晴，花圃里的花朵显得更加鲜艳，吸引了许多蝴蝶。',
          };
          assert.ok(sentences[target], target);
          await page.locator('#own-sentence').fill(sentences[target]);
          await page.locator('#sentence-selfcheck').check();
          await page.locator('#submit-sentence').click();
        } else {
          await page
            .locator('#essay-text')
            .fill(
              '放学后，我看见同学的书散落一地，便尽力帮他捡起来。我们把书整理好，解决了眼前的小麻烦。他向我道谢，我心里也很开心。',
            );
          await page.locator('#check-natural').check();
          await page.locator('#finish-writing').click();
        }
        await done();
        if (stage === 0 && question === 0) await page.locator('[data-rating="practice"]').click();
        await page.locator('#next-question').click();
      }
    assert.ok((await page.locator('#main').innerText()).includes('完成 9 项'));
  });
  await test('Optional timer expires safely without autoplay or a blank screen', async () => {
    await page.addInitScript(() => {
      window.__speechCalls = 0;
      if (window.speechSynthesis) {
        const speak = window.speechSynthesis.speak.bind(window.speechSynthesis);
        window.speechSynthesis.speak = (...args) => {
          window.__speechCalls++;
          return speak(...args);
        };
      }
    });
    await page.clock.install();
    await go('activity/timed');
    await page.reload();
    await page.locator('#session-timer').waitFor();
    await page.clock.runFor(31000);
    assert.ok((await page.locator('#main').innerText()).includes('时间到了'));
    assert.equal(await page.evaluate(() => window.__speechCalls), 0);
  });
  await test('Learning backups export and restore through the settings UI', async () => {
    await go('settings');
    const pending = page.waitForEvent('download');
    await page.locator('#export-progress').click();
    const download = await pending;
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const part of stream) chunks.push(part);
    const buffer = Buffer.concat(chunks),
      data = JSON.parse(buffer.toString('utf8'));
    assert.equal(data.version, 1);
    assert.ok(data.xp > 0);
    assert.ok(Object.keys(data.drafts).length > 0);
    await page.locator('#reset-progress').click();
    await page.locator('#accept-confirm').click();
    await go('settings');
    await page
      .locator('#import-progress')
      .setInputFiles({ name: 'progress.json', mimeType: 'application/json', buffer });
    await page.locator('#accept-confirm').click();
    await page.locator('#main h1').waitFor();
    assert.ok((await page.locator('.header-actions').innerText()).includes(`${data.xp} XP`));
  });
  await test('Storage denial leaves a functioning app with an explicit save warning', async () => {
    const blocked = await browser.newContext();
    await blocked.addInitScript(() =>
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('Storage disabled', 'SecurityError');
        },
      }),
    );
    const tab = await blocked.newPage();
    const blockedErrors = [];
    tab.on('pageerror', (error) => blockedErrors.push(error.message));
    await tab.goto(base);
    await tab.locator('#main h1').waitFor();
    await tab.goto(base + '#library');
    await tab.locator('[data-setting="grade"]').selectOption('4');
    assert.ok((await tab.locator('#toast').textContent()).includes('储存'));
    const expectedGradeFour = source.filter((word) => String(word.grade) === '4').length;
    assert.equal(Number((await tab.locator('#word-count').textContent()).match(/\d+/)?.[0]), expectedGradeFour);
    await tab.goto(base + '#activity/essay?word=3-è§£-è§£å†³');
    const temporaryDraft = 'temporary helper draft';
    await tab.locator('#essay-text').fill(temporaryDraft);
    await tab.locator('[data-word-card]').first().click();
    await tab.locator('#modal a[data-open-helper]').click();
    await tab.locator('[data-return-activity]').click();
    assert.equal(await tab.locator('#essay-text').inputValue(), temporaryDraft);
    await tab.goto(base + '#activity/modelEssay');
    await tab.locator('[data-speak-essay]').click();
    assert.equal(await tab.locator('.essay-sentence--active').count(), 1);
    await tab.locator('[data-speech-rate="1.25"]').click();
    assert.equal(await tab.locator('[data-speech-rate="1.25"].active').count(), 1);
    await tab.locator('[data-speech-control="stop"]').click();
    await tab.waitForFunction(() => document.querySelectorAll('.essay-sentence--active').length === 0);
    assert.deepEqual(blockedErrors, []);
    await blocked.close();
  });
  await test('No extended-flow JavaScript errors', async () => assert.deepEqual(errors, []));
} finally {
  await writeFile(
    new URL('extended-browser-report.json', output),
    JSON.stringify({ results, errors }, null, 2),
  );
  await browser.close();
}
if (results.some((r) => !r.passed)) process.exitCode = 1;
