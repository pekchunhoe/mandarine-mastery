import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { TUTOR_ACTION as A } from '../js/tutor-actions.js';
import { paragraphs, resultFor } from './tutor-fixtures.mjs';
const base = process.env.TEST_URL || 'http://localhost:4173/';
const essay = paragraphs.join('\n\n');
const feedback = resultFor(A.ESSAY_REVIEW);
let browser;
before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_CHANNEL
      ? { channel: process.env.BROWSER_CHANNEL }
      : process.platform === 'win32'
        ? { channel: 'msedge' }
        : {}),
  });
  await mkdir(new URL('../test-results/ai/', import.meta.url), { recursive: true });
});
after(async () => browser?.close());
async function fixture(t, width = 390, height = 844) {
  const context = await browser.newContext({
    viewport: { width, height },
    serviceWorkers: 'block',
  });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(`${base}#activity/guidedEssay`);
  await page.locator('#guided-line').waitFor();
  return page;
}
async function snapshot(page) {
  return page.evaluate(() => ({
    draft: document.querySelector('#guided-line').value,
    preview: document.querySelector('#guided-preview').textContent,
    count: document.querySelector('#guided-total-count').textContent,
    step: document.querySelector('[data-guided-paragraph].active').textContent,
    hash: location.hash,
    history: history.length,
  }));
}
const close = (page) => page.locator('#modal [data-close-modal]').click();
test('feedback displays all sections, preserves draft/count/selection/autosave/history and copy', async (t) => {
  const page = await fixture(t);
  let sent;
  await page.route('**/api/gemini', async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, action: sent.action, data: feedback } });
  });
  await page.locator('#guided-line').fill(essay);
  const before = await snapshot(page);
  await page.locator('[data-ai-action="essay_review"]').click();
  await page.getByText(feedback.summary, { exact: true }).waitFor();
  for (const text of [
    feedback.categories.description.feedback,
    feedback.priorityImprovements[0],
    feedback.studentTask,
  ])
    assert.ok(await page.getByText(text, { exact: true }).isVisible());
  assert.equal(sent.context.studentEssay, essay);
  assert.ok(sent.context.keyPoints.length);
  await close(page);
  assert.deepEqual(await snapshot(page), before);
  await page.reload();
  await page.locator('#guided-line').waitFor();
  assert.equal(await page.locator('#guided-line').inputValue(), essay);
  assert.equal(await page.locator('#guided-copy').isEnabled(), true);
});
test('hint handles blank draft locally, then carries current step without inserting text', async (t) => {
  const page = await fixture(t);
  await page.locator('[data-guided-paragraph="1"]').click();
  await page.locator('[data-ai-action="sentence_hint"]').click();
  await page.getByText('谁在什么地方？', { exact: true }).waitFor();
  await close(page);
  assert.equal(await page.locator('#guided-line').inputValue(), '');
  await page.locator('#guided-line').fill('小明开始跑步。');
  let sent;
  await page.route('**/api/gemini', async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({
      json: {
        ok: true,
        action: A.SENTENCE_HINT,
        data: {
          thinkingQuestions: ['当时看到了什么？', '你做了什么？'],
          usefulPatterns: ['一边……一边……'],
          studentTask: '自己试着写。',
        },
      },
    });
  });
  const before = await snapshot(page);
  await page.locator('[data-ai-action="sentence_hint"]').click();
  await page.getByText('当时看到了什么？', { exact: true }).waitFor();
  assert.equal(sent.context.currentStep, 2);
  assert.equal(sent.context.currentParagraph, '小明开始跑步。');
  await close(page);
  assert.deepEqual(await snapshot(page), before);
});
test('vocabulary recommendations render authoritative records and reuse floating library', async (t) => {
  const page = await fixture(t);
  const records = JSON.parse(
    await readFile(new URL('../data/vocabulary.json', import.meta.url), 'utf8'),
  );
  let chosen;
  await page.route('**/api/gemini', async (route) => {
    const sent = route.request().postDataJSON();
    assert.ok(
      sent.context.availableVocabularyIds.length > 0 &&
        sent.context.availableVocabularyIds.length <= 16,
    );
    chosen = records.find((word) => word.id === sent.context.availableVocabularyIds[0]);
    assert.ok(chosen);
    await route.fulfill({
      json: {
        ok: true,
        action: A.VOCABULARY_HELP,
        data: {
          recommendations: [
            {
              vocabularyId: chosen.id,
              vocabulary: chosen,
              reason: '适合这篇作文。',
              exampleUsage: '这是一个简短例句。',
            },
          ],
          studentTask: '选一个词自己试试。',
        },
      },
    });
  });
  await page.locator('#guided-line').fill(essay);
  const before = await snapshot(page);
  await page.locator('[data-ai-action="vocabulary_help"]').click();
  await page.getByText('适合这篇作文。').waitFor();
  assert.equal(await page.locator('#modal .word-card h4').textContent(), chosen.word);
  if (chosen.definitionChinese)
    assert.ok(
      (await page.locator('#modal .vocabulary-details').textContent()).includes(
        chosen.definitionChinese,
      ),
    );
  assert.equal(await page.locator('#modal [data-speak]').count(), 1);
  await page.locator('[data-ai-vocabulary]').click();
  await page.locator('#lookup-search').fill(chosen.word);
  await page.locator('[data-lookup-word]').first().waitFor();
  await close(page);
  assert.deepEqual(await snapshot(page), before);
  await page.locator('#guided-vocabulary').click();
  await page.locator('#lookup-search').waitFor();
  await close(page);
});
test('paragraph check uses selected text then cursor paragraph and retains selection', async (t) => {
  const page = await fixture(t);
  const text = '第一段写比赛。\n第二段写心情。';
  await page.locator('#guided-line').fill(text);
  let sent;
  await page.route('**/api/gemini', async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({
      json: {
        ok: true,
        action: A.PARAGRAPH_REVIEW,
        data: {
          strengths: ['内容清楚。'],
          missingDetails: ['想想动作。'],
          issues: [
            {
              text: sent.context.currentParagraph,
              type: '表达',
              suggestions: ['可以写得具体些。', '想想具体的动作。'],
            },
          ],
          revisionFocus: '按自己的想法修改。',
          studentTask: '修改后再读一遍。',
        },
      },
    });
  });
  await page.locator('#guided-line').evaluate((el) => {
    el.focus();
    el.setSelectionRange(0, 3);
  });
  await page.locator('[data-ai-action="paragraph_review"]').click();
  await page.getByText('按自己的想法修改。', { exact: true }).waitFor();
  assert.equal(sent.context.currentParagraph, text.slice(0, 3));
  assert.match(await page.locator('.ai-result').textContent(), /做得好的地方.*可以改进.*轮到你了/s);
  await close(page);
  assert.deepEqual(
    await page.locator('#guided-line').evaluate((el) => [el.selectionStart, el.selectionEnd]),
    [0, 3],
  );
  await page.locator('#guided-line').evaluate((el) => {
    el.focus();
    el.setSelectionRange(10, 10);
  });
  await page.locator('[data-ai-action="paragraph_review"]').click();
  await page.getByText('按自己的想法修改。', { exact: true }).waitFor();
  assert.equal(sent.context.currentParagraph, '第二段写心情。');
  await close(page);
  assert.equal(await page.locator('#guided-line').inputValue(), text);
});
test('loading prevents duplicates and retry succeeds', async (t) => {
  const page = await fixture(t);
  await page.locator('#guided-line').fill(essay);
  let calls = 0,
    release;
  await page.route('**/api/gemini', async (route) => {
    calls++;
    if (calls === 1) {
      await new Promise((resolve) => {
        release = resolve;
      });
      await route.fulfill({
        status: 429,
        json: { ok: false, error: { code: 'AI_RATE_LIMIT', message: 'raw-secret' } },
      });
    } else await route.fulfill({ json: { ok: true, action: A.ESSAY_REVIEW, data: feedback } });
  });
  await page.locator('[data-ai-action="essay_review"]').click();
  await page.getByRole('status').filter({ hasText: 'AI老师正在看看你的作文' }).waitFor();
  assert.equal(await page.locator('[data-ai-action]:disabled').count(), 1);
  await page.locator('[data-ai-action="essay_review"]').dispatchEvent('click');
  assert.equal(calls, 1);
  release();
  await page.locator('[data-ai-retry]:not([hidden])').waitFor();
  assert.ok(!(await page.locator('#modal').textContent()).includes('raw-secret'));
  await page.locator('[data-ai-retry]').click();
  await page.getByText(feedback.studentTask, { exact: true }).waitFor();
  assert.equal(calls, 2);
  await close(page);
  assert.equal(await page.locator('#guided-line').inputValue(), essay);
});
test('a controlled quota delay disables every AI action without changing the draft', async (t) => {
  const page = await fixture(t);
  await page.locator('#guided-line').fill(essay);
  await page.route('**/api/gemini', (route) =>
    route.fulfill({
      status: 429,
      json: { ok: false, error: { code: 'AI_RATE_LIMIT', retryAfterSeconds: 5 } },
    }),
  );
  await page.locator('[data-ai-action="essay_review"]').click();
  await page.locator('#modal [role="alert"]').waitFor();
  assert.match(await page.locator('#modal [role="alert"]').textContent(), /5 秒/);
  assert.equal(
    await page
      .locator('[data-ai-action]')
      .evaluateAll((buttons) => buttons.every((button) => button.disabled)),
    true,
  );
  assert.equal(await page.locator('#guided-line').inputValue(), essay);
});
test('close cancels pending result and later response cannot replace vocabulary dialog', async (t) => {
  const page = await fixture(t);
  await page.locator('#guided-line').fill(essay);
  let release, started;
  const requested = new Promise((resolve) => {
    started = resolve;
  });
  await page.route('**/api/gemini', async (route) => {
    started();
    await new Promise((done) => {
      release = done;
    });
    await route
      .fulfill({ json: { ok: true, action: A.ESSAY_REVIEW, data: feedback } })
      .catch(() => {});
  });
  await page.locator('[data-ai-action="essay_review"]').click();
  await requested;
  await close(page);
  assert.equal(await page.locator('[data-ai-action]:disabled').count(), 0);
  await page.locator('#guided-vocabulary').click();
  release();
  await page.locator('#lookup-search').fill('开心');
  await page.locator('[data-lookup-word]').first().waitFor();
  assert.equal(await page.locator('#modal-title').textContent(), '词语库');
  await close(page);
  assert.equal(await page.locator('#guided-line').inputValue(), essay);
});
test('AI output is escaped, keyboard focus stays in dialog, offline error and navigation cleanup work', async (t) => {
  const page = await fixture(t);
  await page.locator('#guided-line').fill(essay);
  await page.route('**/api/gemini', (route) =>
    route.fulfill({
      json: {
        ok: true,
        action: A.ESSAY_REVIEW,
        data: { ...feedback, studentTask: '<img src=x onerror="alert(1)">' },
      },
    }),
  );
  await page.locator('[data-ai-action="essay_review"]').focus();
  await page.keyboard.press('Enter');
  await page.getByText('<img src=x onerror="alert(1)">', { exact: true }).waitFor();
  assert.equal(await page.locator('#modal img').count(), 0);
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press('Tab');
    assert.equal(
      await page.evaluate(() => document.querySelector('#modal').contains(document.activeElement)),
      true,
    );
  }
  await page.keyboard.press('Escape');
  await page.context().setOffline(true);
  await page.locator('[data-ai-action="essay_review"]').click();
  await page.locator('#modal [role="alert"]').waitFor();
  assert.match(await page.locator('#modal [role="alert"]').textContent(), /网络连接失败/);
  await page.context().setOffline(false);
  await page.evaluate(() => {
    location.hash = '#activities';
  });
  await page.locator('.activity-card').first().waitFor();
  assert.equal(await page.locator('#modal').evaluate((el) => el.open), false);
  await page.goBack();
  await page.locator('#guided-line').waitFor();
  assert.equal(await page.locator('#guided-line').inputValue(), essay);
});
test('empty essay and missing configuration show friendly errors, app stays usable', async (t) => {
  const page = await fixture(t);
  await page.locator('[data-ai-action="essay_review"]').click();
  await page.locator('#modal [role="alert"]').waitFor();
  assert.match(await page.locator('#modal [role="alert"]').textContent(), /先多写/);
  await close(page);
  await page.route('**/api/gemini', (route) =>
    route.fulfill({ status: 503, json: { ok: false, error: { code: 'AI_NOT_CONFIGURED' } } }),
  );
  await page.locator('#guided-line').fill(essay);
  await page.locator('[data-ai-action="essay_review"]').click();
  await page.locator('#modal [role="alert"]').waitFor();
  assert.match(await page.locator('#modal [role="alert"]').textContent(), /暂时还不能使用/);
  await close(page);
  await page.locator('#guided-next').click();
  assert.equal(
    await page.locator('[data-guided-paragraph="1"]').getAttribute('aria-current'),
    'step',
  );
});
for (const [width, height] of [
  [320, 740],
  [360, 800],
  [375, 812],
  [390, 844],
  [412, 915],
  [430, 932],
  [844, 390],
  [768, 1024],
  [1024, 768],
  [1440, 900],
]) {
  test(`AI toolbar/dialog responsive ${width}x${height}`, async (t) => {
    const page = await fixture(t, width, height);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#guided-line').fill(essay);
    await page.route('**/api/gemini', (route) =>
      route.fulfill({
        json: {
          ok: true,
          action: A.ESSAY_REVIEW,
          data: { ...feedback, summary: '具体的中文建议。'.repeat(24) },
        },
      }),
    );
    const boxes = await page.locator('[data-ai-action]').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, height: r.height };
      }),
    );
    assert.ok(boxes.every((box) => box.x >= 0 && box.right <= width && box.height >= 44));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        assert.ok(
          boxes[i].right <= boxes[j].x ||
            boxes[j].right <= boxes[i].x ||
            boxes[i].bottom <= boxes[j].y ||
            boxes[j].bottom <= boxes[i].y,
        );
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('[data-ai-action="essay_review"]').click();
    await page.getByText(feedback.studentTask, { exact: true }).waitFor();
    assert.ok(await page.locator('#modal').evaluate((el) => el.scrollWidth <= el.clientWidth));
    assert.ok(await page.locator('[data-close-modal]').isVisible());
    await page.screenshot({ path: `test-results/ai/${width}x${height}.png` });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#modal').evaluate((el) => el.open), false);
    assert.equal(
      await page
        .locator('[data-ai-action="essay_review"]')
        .evaluate((el) => el === document.activeElement),
      true,
    );
  });
}
