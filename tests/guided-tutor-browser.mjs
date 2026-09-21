import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import {
  TUTOR_ACTION as A,
  TUTOR_ACTIVITY as B,
  activityTutorActions,
} from '../js/tutor-actions.js';
import { resultFor, sentence, paragraphs, malformedResults } from './tutor-fixtures.mjs';
import { createTeacherHandler } from '../server/ai-handler.js';
import { builders } from '../data/content.js';
const base = process.env.TEST_URL || 'http://localhost:4173/';
const route = 'activity/builder?word=3-解-解决&mode=free';
const records = JSON.parse(
  await readFile(new URL('../data/vocabulary.json', import.meta.url), 'utf8'),
);
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
  await mkdir(new URL('../test-results/tutor/', import.meta.url), { recursive: true });
});
after(async () => browser?.close());
async function fixture(t, activity = B.SENTENCE, viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  t.after(() => context.close());
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(base + '#' + (activity === B.SENTENCE ? route : 'activity/guidedEssay'));
  await page.locator(activity === B.SENTENCE ? '#own-sentence' : '#guided-line').waitFor();
  return page;
}
async function mockTutor(page, transform) {
  const requests = [];
  await page.route('**/api/gemini', async (route) => {
    const input = route.request().postDataJSON();
    requests.push(input);
    const chosen = records.find((word) => word.id === input.context.availableVocabularyIds?.[0]);
    const data = resultFor(input.action, input.context, chosen, true);
    await route.fulfill({
      json: { ok: true, action: input.action, data: transform ? transform(input, data) : data },
    });
  });
  return requests;
}
const clickAI = (page, action) => page.locator(`[data-ai-action="${action}"]`).click();
const close = (page) => page.locator('#modal [data-close-modal]').click();
const done = (page) =>
  page.locator('.ai-result[aria-busy="false"] h3').filter({ hasText: '轮到你了' }).waitFor();
async function sentenceSetup(page) {
  await page.locator('#sentence-context').selectOption('你自己想到的情境');
  await page.locator('#custom-sentence-context').fill('运动会');
  await page.locator('#own-sentence').fill(sentence);
}
const sentenceState = (page) =>
  page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    return {
      text: document.querySelector('#own-sentence').value,
      situation: document.querySelector('#sentence-context').value,
      custom: document.querySelector('#custom-sentence-context').value,
      checked: document.querySelector('#sentence-selfcheck').checked,
      drafts: JSON.stringify(state.drafts),
      xp: state.xp,
      hash: location.hash,
      history: history.length,
    };
  });
const essayState = (page) =>
  page.evaluate(() => ({
    text: document.querySelector('#guided-line').value,
    preview: document.querySelector('#guided-preview').textContent,
    count: document.querySelector('#guided-total-count').textContent,
    title: document.querySelector('#training-topic').value,
    step: document.querySelector('[data-guided-paragraph].active').textContent,
    help: document.querySelector('.guided-help').textContent,
    hash: location.hash,
    history: history.length,
  }));

for (const action of activityTutorActions[B.SENTENCE])
  test(`sentence workflow: ${action}, situation and draft preserved`, async (t) => {
    const page = await fixture(t);
    await sentenceSetup(page);
    const sent = await mockTutor(page);
    const before = await sentenceState(page);
    await clickAI(page, action);
    await done(page);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].activity, B.SENTENCE);
    assert.equal(sent[0].context.situation, '运动会');
    assert.equal(sent[0].context.studentSentence, sentence);
    const body = await page.locator('.ai-result').textContent();
    if (action === A.SENTENCE_HINT) {
      assert.match(body, /小明参加什么比赛/);
      assert.match(body, /一边……一边……/);
    }
    if (action === A.SENTENCE_CHECK) {
      assert.match(body, /没有发现明显错误/);
      assert.match(body, /可选的表达建议/);
      await page.getByText('❓ 为什么？', { exact: true }).click();
      assert.ok(
        await page.getByText('原句通顺，这只是可选的描写方法。', { exact: true }).isVisible(),
      );
      assert.equal(sent.length, 1);
    }
    if (action === A.SENTENCE_EXPAND)
      for (const level of [1, 2, 3]) assert.match(body, new RegExp(`第 ${level} 步`));
    if (action === A.SENTENCE_VIVID) {
      assert.match(body, /动作描写/);
      assert.match(body, /小明____，____/);
    }
    if (action === A.VOCABULARY_HELP) {
      const chosen = records.find((word) => word.id === sent[0].context.availableVocabularyIds[0]);
      for (const field of [
        'word',
        'pinyin',
        'definitionChinese',
        'generatedSynonyms',
        'exampleSentence',
      ])
        if (chosen[field]) assert.ok(body.includes(chosen[field]));
      assert.equal(
        await page.locator('#modal [data-speak]').getAttribute('data-speak'),
        chosen.word,
      );
      await page.locator('#modal [data-speak]').click();
    }
    await close(page);
    assert.deepEqual(await sentenceState(page), before);
  });
test('sentence error vs optional style rendering and original preserved', async (t) => {
  const page = await fixture(t);
  await sentenceSetup(page);
  await page.locator('#own-sentence').fill('我非常七上八下地跑去学校。');
  await mockTutor(page, (_, data) => ({
    ...data,
    status: 'needs_revision',
    issues: [
      {
        category: 'word_choice',
        severity: 'error',
        text: '七上八下不是跑步的动作。',
        explanation: '这个词形容心里紧张、不安。',
      },
    ],
    suggestedRevision: '我心里七上八下，匆匆跑去学校。',
  }));
  await clickAI(page, A.SENTENCE_CHECK);
  await done(page);
  assert.match(await page.locator('.ai-result').textContent(), /需要检查.*用词.*可选/s);
  await page.locator('#modal summary').first().click();
  assert.ok(await page.getByText('这个词形容心里紧张、不安。', { exact: true }).isVisible());
  await close(page);
  assert.equal(await page.locator('#own-sentence').inputValue(), '我非常七上八下地跑去学校。');
});
test('sentence autosave/custom situation/copy/Back/Forward/refresh survive tutoring', async (t) => {
  const page = await fixture(t);
  await sentenceSetup(page);
  await mockTutor(page);
  await clickAI(page, A.SENTENCE_HINT);
  await done(page);
  await close(page);
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (text) => {
      window.copiedSentence = text;
    };
  });
  await page.locator('#copy-sentence').click();
  assert.equal(await page.evaluate(() => window.copiedSentence), sentence);
  await page.evaluate(() => {
    location.hash = '#activities';
  });
  await page.locator('.activity-card').first().waitFor();
  await page.locator('[data-navigation-back]').click();
  await page.locator('#own-sentence').waitFor();
  assert.equal(await page.locator('#own-sentence').inputValue(), sentence);
  await page.goForward();
  await page.locator('.activity-card').first().waitFor();
  await page.goBack();
  await page.locator('#own-sentence').waitFor();
  await page.reload();
  await page.locator('#own-sentence').waitFor();
  assert.equal(await page.locator('#own-sentence').inputValue(), sentence);
  assert.equal(await page.locator('#sentence-context').inputValue(), '你自己想到的情境');
  assert.equal(await page.locator('#custom-sentence-context').inputValue(), '运动会');
});
test('three-paragraph essay: all five actions, previous context, full review, copy and reset', async (t) => {
  const page = await fixture(t, B.ESSAY);
  await page.locator('[data-training-filter="grade"]').selectOption('');
  const topic = await page
    .locator('#training-topic option')
    .evaluateAll(
      (options) => options.find((option) => option.textContent.includes('一次难忘的经历'))?.value,
    );
  assert.ok(topic);
  await page.locator('#training-topic').selectOption(topic);
  for (let index = 0; index < 3; index++) {
    await page.locator(`[data-guided-paragraph="${index}"]`).click();
    await page.locator('#guided-line').fill(paragraphs[index]);
  }
  await page.waitForFunction(
    (text) =>
      Object.values(JSON.parse(localStorage.getItem('huawen-lab-v1')).drafts).some(
        (draft) => draft.text === text,
      ),
    paragraphs.join('\n\n'),
  );
  const sent = await mockTutor(page),
    before = await essayState(page);
  for (const action of activityTutorActions[B.ESSAY]) {
    await clickAI(page, action);
    await done(page);
    const input = sent.at(-1);
    assert.equal(input.context.essayTitle, '一次难忘的经历');
    assert.ok(input.context.keyPoints.length);
    if (action === A.ESSAY_NEXT_STEP) {
      assert.deepEqual(input.context.previousParagraphs, paragraphs.slice(0, 2));
      assert.equal(input.context.currentParagraph, paragraphs[2]);
      assert.match(await page.locator('.ai-result').textContent(), /比赛的开始和经过/);
    }
    if (action === A.PARAGRAPH_REVIEW) {
      assert.deepEqual(input.context.previousParagraphs, [paragraphs[1]]);
      assert.equal(input.context.currentParagraph, paragraphs[2]);
    }
    if (action === A.ESSAY_REVIEW) {
      assert.equal(input.context.studentEssay, paragraphs.join('\n\n'));
      for (const label of ['切题', '结构', '描写', '词语', '语言', '优先修改'])
        assert.match(await page.locator('.ai-result').textContent(), new RegExp(label));
    }
    await close(page);
    assert.deepEqual(await essayState(page), before);
  }
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (text) => {
      window.copiedEssay = text;
    };
  });
  await page.locator('#guided-copy').click();
  assert.equal(await page.evaluate(() => window.copiedEssay), paragraphs.join('\n\n'));
  await page.reload();
  await page.locator('#guided-line').waitFor();
  // Default grade filtering may select another topic; select the saved exercise again.
  await page.locator('[data-training-filter="grade"]').selectOption('');
  await page.locator('#training-topic').selectOption(topic);
  assert.equal(await page.locator('#guided-preview').textContent(), paragraphs.join('\n\n'));
  await page.locator('#guided-reset').click();
  assert.equal(await page.locator('#guided-total-count').textContent(), '0');
});
test('block-building mode retains selections and tutor controls after redraw', async (t) => {
  const page = await fixture(t);
  const record = records.find(item => builders[item.word]);
  await page.goto(base + '#activity/builder?word=' + encodeURIComponent(record.id));
  await page.locator('[data-part]').first().waitFor();
  for (const key of ['when', 'who', 'event', 'action']) await page.locator(`[data-part="${key}:0"]`).click();
  const text = await page.locator('.sentence-display').textContent();
  const sent = await mockTutor(page);
  await clickAI(page, A.SENTENCE_CHECK); await done(page); await close(page);
  assert.equal(sent[0].context.studentSentence, text);
  assert.equal(await page.locator('.sentence-display').textContent(), text);
  assert.equal(await page.locator('[data-part][aria-pressed="true"]').count(), 4);
  await page.locator('[data-part="when:1"]').click();
  assert.equal(await page.locator('[data-ai-action]').count(), 5);
  await clickAI(page, A.SENTENCE_HINT); await done(page); await close(page);
  assert.equal(sent[1].context.studentSentence, await page.locator('.sentence-display').textContent());
});
test('sentence loading, malformed response, retry and offline failure preserve the draft', async (t) => {
  const page = await fixture(t); await sentenceSetup(page);
  let calls = 0, release;
  await page.route('**/api/gemini', async route => {
    calls++;
    if (calls === 1) {
      await new Promise(resolve => { release = resolve; });
      await route.fulfill({ json: { ok: true, action: A.SENTENCE_CHECK, data: {} } });
    } else await route.fulfill({ json: { ok: true, action: A.SENTENCE_CHECK, data: resultFor(A.SENTENCE_CHECK) } });
  });
  const before = await sentenceState(page);
  await clickAI(page, A.SENTENCE_CHECK);
  await page.getByRole('status').filter({ hasText: 'AI老师正在看看你的句子' }).waitFor();
  assert.equal(await page.locator('[data-ai-action]:disabled').count(), 1);
  await page.waitForFunction(() => document.querySelector('.ai-result')?.getAttribute('aria-busy') === 'true');
  release(); await page.locator('[data-ai-retry]:not([hidden])').waitFor();
  await page.locator('[data-ai-retry]').click(); await done(page); await close(page);
  assert.deepEqual(await sentenceState(page), before); assert.equal(calls, 2);
  await page.context().setOffline(true); await clickAI(page, A.SENTENCE_CHECK);
  await page.locator('#modal [role="alert"]').waitFor(); await close(page);
  assert.deepEqual(await sentenceState(page), before); await page.context().setOffline(false);
});
for (const action of [A.SENTENCE_CHECK, A.PARAGRAPH_REVIEW])
  test(`${action}: malformed Gemini output reaches friendly error and one-request retry`, async (t) => {
    const activity = action === A.SENTENCE_CHECK ? B.SENTENCE : B.ESSAY;
    const page = await fixture(t, activity);
    if (activity === B.SENTENCE) await sentenceSetup(page);
    else await page.locator('#guided-line').fill(paragraphs.join('\n\n'));
    const state = activity === B.SENTENCE ? sentenceState : essayState;
    const before = await state(page);
    for (const [name, raw] of malformedResults(resultFor(action))) {
      let calls = 0, providerCalls = 0;
      const endpoint = createTeacherHandler({
        env: { GEMINI_API_KEY: 'test-only-secret' },
        generate: async (input) => ++providerCalls === 1 ? raw : JSON.stringify(resultFor(action, input.context)),
      });
      await page.route('**/api/gemini', async route => {
        calls++;
        const response = await endpoint(new Request(route.request().url(), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: route.request().postData(),
        }));
        assert.equal(response.status, calls === 1 ? 502 : 200, name);
        await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
      });
      await clickAI(page, action);
      await page.locator('#modal [role="alert"]').waitFor();
      assert.match(await page.locator('#modal [role="alert"]').textContent(), /回复不完整/);
      assert.equal(await page.locator('[data-ai-action]:disabled').count(), 0);
      await page.locator('[data-ai-retry]').click();
      await done(page);
      assert.equal(calls, 2, name);
      assert.equal(providerCalls, 2, name);
      await close(page);
      assert.deepEqual(await state(page), before, name);
      await page.unroute('**/api/gemini');
    }
  });

test('late malformed response cannot replace a newer successful result', async (t) => {
  const page = await fixture(t);
  await sentenceSetup(page);
  // Deliberately ignore AbortSignal to exercise the session guard independently of fetch cancellation.
  await page.evaluate(async () => {
    const { aiTeacher } = await import('/js/ai-teacher.js');
    aiTeacher.sentence_check = () => new Promise(resolve => { window.releaseMalformedTutor = () => resolve({}); });
  });
  await mockTutor(page);
  await clickAI(page, A.SENTENCE_CHECK);
  await page.locator(`[data-ai-action="${A.SENTENCE_VIVID}"]`).dispatchEvent('click');
  await done(page);
  const successful = await page.locator('.ai-result').textContent();
  await page.evaluate(async () => { window.releaseMalformedTutor(); await Promise.resolve(); });
  assert.equal(await page.locator('.ai-result').textContent(), successful);
  assert.equal(await page.locator('#modal [role="alert"]').count(), 0);
  await close(page);
  assert.equal(await page.locator('#own-sentence').inputValue(), sentence);
});

test('block composition survives mode switching, navigation, reload and normal submission', async (t) => {
  const page = await fixture(t);
  const record = records.find(item => builders[item.word]);
  await page.goto(base + '#activity/builder?word=' + encodeURIComponent(record.id));
  for (const key of ['action', 'event', 'who', 'when']) await page.locator(`[data-part="${key}:1"]`).click();
  const text = await page.locator('.sentence-display').textContent();
  await page.getByRole('link', { name: '挑战：自己写一句' }).click();
  await page.locator('#own-sentence').fill(text);
  await page.locator('[data-navigation-back]').click();
  await page.locator('[data-part]').first().waitFor();
  assert.equal(await page.locator('.sentence-display').textContent(), text);
  await page.reload();
  await page.locator('[data-part]').first().waitFor();
  assert.equal(await page.locator('.sentence-display').textContent(), text);
  assert.equal(await page.locator('[data-part][aria-pressed="true"]').count(), 4);
  await page.locator('#reset-activity').click();
  await page.locator('#accept-confirm').click();
  assert.equal(await page.locator('[data-part][aria-pressed="true"]').count(), 0);
  await page.reload();
  await page.locator('[data-part]').first().waitFor();
  assert.equal(await page.locator('[data-part][aria-pressed="true"]').count(), 0);
  await page.getByRole('link', { name: '挑战：自己写一句' }).click();
  assert.equal(await page.locator('#own-sentence').inputValue(), text);
  await page.locator('[data-navigation-back]').click();
  for (const key of ['when', 'who', 'event', 'action']) await page.locator(`[data-part="${key}:0"]`).click();
  await page.locator('#finish-builder').click();
  await page.locator('#activity-feedback').waitFor();
  assert.ok((await page.locator('#activity-feedback').textContent()).includes('第二句'));
});

test('empty sentence/paragraph and short essay use no requests', async (t) => {
  const sentencePage = await fixture(t),
    essayPage = await fixture(t, B.ESSAY);
  let calls = 0;
  for (const page of [sentencePage, essayPage])
    await page.route('**/api/gemini', (route) => {
      calls++;
      return route.abort();
    });
  await clickAI(sentencePage, A.SENTENCE_HINT);
  await done(sentencePage);
  await close(sentencePage);
  for (const action of [A.SENTENCE_CHECK, A.SENTENCE_EXPAND, A.SENTENCE_VIVID]) {
    await clickAI(sentencePage, action);
    await sentencePage.locator('#modal [role="alert"]').waitFor();
    await close(sentencePage);
  }
  for (const action of [A.PARAGRAPH_REVIEW, A.ESSAY_REVIEW]) {
    await clickAI(essayPage, action);
    await essayPage.locator('#modal [role="alert"]').waitFor();
    await close(essayPage);
  }
  await essayPage.locator('#guided-line').fill('今天很好。');
  await clickAI(essayPage, A.ESSAY_REVIEW);
  await essayPage.locator('#modal [role="alert"]').waitFor();
  assert.equal(calls, 0);
});
test('new request supersedes old result, repeated action stays singular', async (t) => {
  const page = await fixture(t);
  await sentenceSetup(page);
  let started,
    release,
    calls = 0;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  await page.route('**/api/gemini', async (route) => {
    const input = route.request().postDataJSON();
    calls++;
    if (input.action === A.SENTENCE_CHECK) {
      started();
      await new Promise((resolve) => {
        release = resolve;
      });
    }
    await route
      .fulfill({
        json: { ok: true, action: input.action, data: resultFor(input.action, input.context) },
      })
      .catch(() => {});
  });
  await clickAI(page, A.SENTENCE_CHECK);
  await ready;
  await page.locator(`[data-ai-action="${A.SENTENCE_CHECK}"]`).dispatchEvent('click');
  assert.equal(calls, 1);
  await page.locator(`[data-ai-action="${A.SENTENCE_VIVID}"]`).dispatchEvent('click');
  await done(page);
  release();
  await page.locator('#modal [data-close-modal]').focus();
  assert.match(await page.locator('#modal-title').textContent(), /写得更生动/);
  assert.match(await page.locator('.ai-result').textContent(), /动作描写/);
  assert.equal(calls, 2);
  await close(page);
  assert.equal(await page.locator('#own-sentence').inputValue(), sentence);
});
test('sentence keyboard Tab/Shift+Tab/Escape and close/reopen race', async (t) => {
  const page = await fixture(t);
  await sentenceSetup(page);
  await mockTutor(page);
  await page.locator(`[data-ai-action="${A.SENTENCE_CHECK}"]`).focus();
  await page.keyboard.press('Enter');
  await done(page);
  await page.locator('[data-close-modal]').focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(
    await page.locator('[data-ai-vocabulary]').evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press('Tab');
  assert.equal(
    await page.locator('[data-close-modal]').evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press('Escape');
  assert.equal(
    await page
      .locator(`[data-ai-action="${A.SENTENCE_CHECK}"]`)
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await clickAI(page, A.SENTENCE_CHECK);
  await done(page);
  await page.evaluate(() => {
    document.querySelector('[data-close-modal]').click();
    document.querySelector('[data-ai-action="sentence_vivid"]').click();
  });
  await done(page);
  assert.equal(await page.locator('#modal').evaluate((el) => el.open), true);
  assert.match(await page.locator('#modal-title').textContent(), /写得更生动/);
  await close(page);
});
test('leaving during pending request cannot open stale panel on Back', async (t) => {
  const page = await fixture(t);
  await sentenceSetup(page);
  let release, started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  await page.route('**/api/gemini', async (route) => {
    started();
    await new Promise((resolve) => {
      release = resolve;
    });
    await route
      .fulfill({ json: { ok: true, action: A.SENTENCE_CHECK, data: resultFor(A.SENTENCE_CHECK) } })
      .catch(() => {});
  });
  await clickAI(page, A.SENTENCE_CHECK);
  await ready;
  await page.evaluate(() => {
    location.hash = '#activities';
  });
  await page.locator('.activity-card').first().waitFor();
  release();
  assert.equal(await page.locator('#modal').evaluate((el) => el.open), false);
  await page.goBack();
  await page.locator('#own-sentence').waitFor();
  assert.equal(await page.locator('#modal').evaluate((el) => el.open), false);
  assert.equal(await page.locator('#own-sentence').inputValue(), sentence);
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
  test(`sentence tutor responsive ${width}x${height}, rotation preserves draft`, async (t) => {
    const page = await fixture(t, B.SENTENCE, { width, height });
    await sentenceSetup(page);
    await mockTutor(page, (_, data) => ({ ...data, studentTask: '长中文建议。'.repeat(30) }));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const buttons = await page.locator('[data-ai-action]').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, height: r.height };
      }),
    );
    assert.equal(buttons.length, 5);
    assert.ok(buttons.every((r) => r.x >= 0 && r.right <= width && r.height >= 44));
    for (let i = 0; i < buttons.length; i++)
      for (let j = i + 1; j < buttons.length; j++) {
        const a = buttons[i],
          b = buttons[j];
        assert.ok(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y);
      }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('#submit-sentence').scrollIntoViewIfNeeded();
    const submitHit = await page.locator('#submit-sentence').evaluate(el => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { reachable: el.contains(hit), y: r.y, bottom: r.bottom, hit: hit?.outerHTML };
    });
    assert.ok(submitHit.reachable, JSON.stringify(submitHit));
    await page.locator('.ai-toolbar').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/tutor/sentence-toolbar-${width}.png` });
    await clickAI(page, A.SENTENCE_VIVID);
    await done(page);
    assert.ok(
      await page
        .locator('#modal')
        .evaluate(
          (el) =>
            el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().bottom <= innerHeight,
        ),
    );
    await page.screenshot({ path: `test-results/tutor/sentence-dialog-${width}.png` });
    await page.setViewportSize({ width: height, height: width });
    assert.ok(await page.locator('[data-close-modal]').isVisible());
    await close(page);
    assert.equal(await page.locator('#own-sentence').inputValue(), sentence);
    assert.equal(await page.locator('#custom-sentence-context').inputValue(), '运动会');
  });
}
