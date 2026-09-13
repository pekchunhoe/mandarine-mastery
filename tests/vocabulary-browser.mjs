import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeRecord } from '../js/vocabulary-schema.js';
import { toXLSX } from '../js/vocabulary-file.js';
import { activities } from '../data/activities.js';
import { createVocabularyService } from '../js/vocabulary-service.js';
import { getEssayTitles } from '../js/essay-title-service.js';
const bundledRecords = JSON.parse(await readFile(new URL('../data/vocabulary.json', import.meta.url), 'utf8'));
const bundledCount = bundledRecords.length;
const bundledService = createVocabularyService(bundledRecords);
const base = process.env.TEST_URL || 'http://localhost:4173/';
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 375, height: 812 },
  acceptDownloads: true,
});
const page = await context.newPage(),
  errors = [],
  results = [];
page.setDefaultTimeout(15000);
page.on('pageerror', (error) => errors.push(error.message));
const out = new URL('../test-results/', import.meta.url);
await mkdir(out, { recursive: true });
async function check(name, fn) {
  await fn();
  results.push(name);
  console.log('PASS ' + name);
}
async function go(hash) {
  await page.goto(base + '#' + hash);
  await page.locator('#main').waitFor();
}
async function upload(name, content, type = 'text/csv') {
  await page
    .locator('#vocabulary-file')
    .setInputFiles({ name, mimeType: type, buffer: Buffer.from(content) });
  await page.locator('#confirm-import').waitFor();
}
async function saved() {
  await page.locator('#library-status').filter({ hasText: '已保存' }).waitFor();
}
async function exported(format) {
  const promise = page.waitForEvent('download');
  await page.locator(`[data-export="${format}"]`).click();
  const d = await promise;
  return readFile(await d.path());
}
try {
  await check(
    'Teacher library loads, searches, filters and paginates existing records',
    async () => {
      await go('teacher');
      await page.getByRole('link', { name: '管理词语库 · 导入 / 编辑 / 导出' }).click();
      await page.locator('#manage-count').filter({ hasText: `${bundledCount} 条` }).waitFor();
      assert.equal(await page.locator('#manage-rows tr').count(), 25);
      await page.locator('#manage-search').fill('钥匙');
      await page.locator('#manage-count').filter({ hasText: `${bundledService.searchWords('钥匙').length} 条` }).waitFor();
      await page.locator('#manage-search').fill('');
      await page.locator('[data-library-filter="grade"]').selectOption('4');
      await page.locator('#manage-count').filter({ hasText: `${bundledRecords.filter((w) => w.grade === 4).length} 条` }).waitFor();
      await page.locator('[data-library-filter="grade"]').selectOption('all');
      await page.locator('#manage-next').click();
      assert.match(await page.locator('#manage-count').textContent(), /第 2/);
      await page.locator('#manage-sort').selectOption('grade');
      await page.locator('#manage-direction').click();
    },
  );
  await check(
    'Manual add/edit/delete uses stable IDs and preserves local changes across reload',
    async () => {
      await page.locator('[data-library-filter="grade"]').selectOption('6');
      await page.locator('#add-vocabulary').click();
      await page.locator('[name="word"]').fill('测试校园词');
      await page.locator('[name="grade"]').fill('6');
      await page.locator('[name="pinyin"]').fill('xiào yuán');
      await page.locator('#vocabulary-editor button[type="submit"]').click();
      await saved();
      await page.locator('#manage-search').fill('测试校园词');
      await page.locator('#manage-count').filter({ hasText: /^1 条/ }).waitFor();
      const id = await page.locator('[data-edit-vocabulary]').getAttribute('data-edit-vocabulary');
      await page.locator('[data-edit-vocabulary]').click();
      await page.locator('[name="meaningEnglish"]').fill('campus');
      assert.equal(await page.locator('[name="id"]').inputValue(), id);
      assert.ok((await page.locator('[name="id"]').getAttribute('readonly')) !== null);
      await page.locator('#vocabulary-editor button[type="submit"]').click();
      await saved();
      await page.reload();
      await page.locator('#manage-search').fill('campus');
      await page.locator('#manage-count').filter({ hasText: /^1 条/ }).waitFor();
      await page.locator('[data-delete-vocabulary]').click();
      await page.locator('#cancel-confirm').click();
      assert.equal(await page.locator('[data-edit-vocabulary]').count(), 1);
      await page.locator('[data-delete-vocabulary]').click();
      await page.locator('#accept-confirm').click();
      await saved();
      await page.locator('#manage-count').filter({ hasText: /^0 条/ }).waitFor();
      await page.locator('#manage-search').fill('');
      await page.locator('[data-library-filter="grade"]').selectOption('all');
    },
  );
  const newWord = normalizeRecord({
    word: '图书馆',
    grade: 6,
    pinyin: 'tú shū guǎn',
    meaningEnglish: 'library',
    meaningMalay: 'perpustakaan',
    category: '学校',
    difficulty: 2,
    tags: ['阅读'],
    essayTopics: ['我的学校'],
    collocations: ['到图书馆看书'],
    exampleSentence: '放学后，我和姐姐一起到图书馆看书。',
  }).record;
  await check(
    'Excel preview does not write before confirmation; merge and metadata reach the library',
    async () => {
      await upload(
        'Year6.xlsx',
        await toXLSX([newWord]),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      assert.match(await page.locator('#import-preview').textContent(), /有效新词 1/);
      assert.match(await page.locator('#manage-count').textContent(), new RegExp(`${bundledCount} 条`));
      await page.locator('#cancel-import').click();
      assert.match(await page.locator('#manage-count').textContent(), new RegExp(`${bundledCount} 条`));
      await upload('Year6.xlsx', await toXLSX([newWord]));
      await page.locator('#confirm-import').click();
      await saved();
      await page.locator('#manage-search').fill('tu shu guan');
      await page.locator('#manage-count').filter({ hasText: /^1 条/ }).waitFor();
      assert.match(await page.locator('#manage-rows').textContent(), /perpustakaan/);
    },
  );
  await check(
    'CSV preview reports bad rows, duplicates and blank rows; skip and update behave correctly',
    async () => {
      const csv =
        '词语,年级,英文意思\n图书馆,6,updated library\n图书馆,6,duplicate\n,3,missing\n天空,9,invalid\n,,\n';
      await upload('check.csv', csv);
      const text = await page.locator('#import-preview').textContent();
      for (const label of ['检测行数 4', '已有词语 1', '重复行 1', '不完整 1', '无效 1'])
        assert.ok(text.includes(label), label);
      await page.locator('#import-problems').check();
      assert.equal(await page.locator('.import-row').count(), 4);
      await page.locator('#confirm-import').click();
      await saved();
      assert.ok(!(await page.locator('#manage-rows').textContent()).includes('updated library'));
      await upload('update.csv', '词语,年级,英文意思\n图书馆,6,updated library');
      await page.locator('#import-duplicates').selectOption('update');
      await page.locator('#confirm-import').click();
      await saved();
      assert.match(await page.locator('#manage-rows').textContent(), /updated library/);
    },
  );
  await check(
    'Combined student filters and all activity screens can use an imported Year 6 word',
    async () => {
      await go('activities');
      await page.locator('[data-setting="grade"]').selectOption('6');
      await page.locator('.advanced-filters summary').click();
      await page.locator('[data-setting="category"]').selectOption('学校');
      await page.locator('[data-setting="wordDifficulty"]').selectOption('2');
      await page.locator('[data-setting="tag"]').selectOption('阅读');
      await page.locator('[data-setting="essayTopic"]').selectOption('我的学校');
      for (const a of activities) {
        await go(`activity/${a.id}?word=${encodeURIComponent(newWord.id)}`);
        assert.equal(await page.locator('#activity-body').count(), 1, a.id);
        assert.ok(!(await page.locator('#main').textContent()).includes('暂时无法'), a.id);
      }
      await go('activity/essay?word=' + encodeURIComponent(newWord.id));
      const topics = getEssayTitles({ grade: 6 });
      assert.equal(await page.locator('#writing-theme option:checked').textContent(), `《${topics[0].title}》`);
      assert.match(await page.locator('#writing-targets').textContent(), /图书馆/);
      await page.locator('#writing-theme').selectOption('1');
      assert.equal(await page.locator('#writing-theme option:checked').textContent(), `《${topics[1].title}》`);
      // The current writing activity retains explicitly selected vocabulary across topics.
      assert.equal(await page.locator(`#writing-targets [data-word-card="${newWord.id}"]`).count(), 1);
    },
  );
  let backup;
  await check(
    'JSON, CSV and XLSX exports retain metadata and reimport with stable IDs',
    async () => {
      await go('vocabulary-admin');
      backup = await exported('json');
      const record = JSON.parse(backup).find((w) => w.id === newWord.id);
      assert.equal(record.meaningEnglish, 'updated library');
      assert.deepEqual(record.essayTopics, ['我的学校']);
      assert.equal(record.character, '');
      for (const format of ['json', 'csv', 'xlsx']) {
        const bytes = format === 'json' ? backup : await exported(format);
        await upload('backup.' + format, bytes);
        assert.match(await page.locator('#import-preview').textContent(), new RegExp(`已有词语 ${bundledCount + 1}`));
        assert.match(await page.locator('#import-preview').textContent(), /无效 0/);
        await page.locator('#cancel-import').click();
      }
    },
  );
  await check(
    'Replacement requires explicit confirmation; progress survives replacement and restore',
    async () => {
      const originalProgress = await page.evaluate(() => localStorage.getItem('huawen-lab-v1'));
      await upload('replace.csv', 'word,grade\n星星,1');
      await page.locator('#import-mode').selectOption('replace');
      await page.locator('#confirm-import').click();
      await page.locator('#cancel-confirm').click();
      assert.match(await page.locator('#manage-count').textContent(), new RegExp(`${bundledCount + 1} 条`));
      await page.locator('#confirm-import').click();
      await page.locator('#accept-confirm').click();
      await saved();
      assert.match(await page.locator('#manage-count').textContent(), /1 条/);
      assert.equal(
        await page.evaluate(() => localStorage.getItem('huawen-lab-v1')),
        originalProgress,
      );
      await upload('backup.json', backup);
      await page.locator('#import-mode').selectOption('replace');
      await page.locator('#confirm-import').click();
      await page.locator('#accept-confirm').click();
      await saved();
      assert.match(await page.locator('#manage-count').textContent(), new RegExp(`${bundledCount + 1} 条`));
    },
  );
  await check(
    'Missing examples are handled by independent writing without artificial sentences',
    async () => {
      const optional = normalizeRecord({ word: '测试无例句词', grade: 1 }).record;
      await upload('optional.csv', `id,word,grade\n${optional.id},${optional.word},1`);
      await page.locator('#confirm-import').click();
      await saved();
      await go('activities');
      await page.locator('[data-setting="grade"]').selectOption('1');
      await page.locator('[data-clear-vocabulary-filters]').click();
      for (const id of ['cloze', 'memory', 'doctor', 'expansion', 'puzzle']) {
        await go('activity/' + id + '?word=' + encodeURIComponent(optional.id));
        assert.equal(await page.locator('#own-sentence').count(), 1, id);
      }
    },
  );
  await check(
    '10,000 browser-imported records remain paginated, searchable and responsive',
    async () => {
      await go('vocabulary-admin');
      const large =
        'word,grade,category,tags\n' +
        Array.from({ length: 10000 }, (_, i) => `测试词语${i},${(i % 6) + 1},学校,测试`).join('\n');
      await upload('large.csv', large);
      assert.match(await page.locator('#import-preview').textContent(), /有效新词 10000/);
      assert.equal(await page.locator('.import-row').count(), 25);
      await page.locator('#confirm-import').click();
      await saved();
      assert.equal(await page.locator('#manage-rows tr').count(), 25);
      await page.locator('#manage-search').fill('测试词语9999');
      await page.locator('#manage-count').filter({ hasText: /^1 条/ }).waitFor();
    await page.locator('#manage-search').fill('');
    await page.locator('#manage-count').filter({ hasText: `${bundledCount + 10002} 条` }).waitFor();
    for (const [width, height] of [
        [320, 740],
        [812, 375],
        [768, 1024],
        [1024, 768],
        [1366, 900],
        [1920, 1080],
      ]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.scrollTo(0, 0));
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          `${width}: no overflow`,
        );
        await page.screenshot({
          path: fileURLToPath(new URL(`vocabulary-${width}.png`, out)),
          fullPage: false,
        });
      }
      await page.reload();
      await page.locator('#manage-count').filter({ hasText: `${bundledCount + 10002} 条` }).waitFor();
    },
  );
  await check(
    'Malformed files show errors without altering library; local reset restores bundled data',
    async () => {
      await page
        .locator('#vocabulary-file')
        .setInputFiles({
          name: 'bad.json',
          mimeType: 'application/json',
          buffer: Buffer.from('{bad'),
        });
      await page.locator('#library-status.notice').waitFor();
      assert.match(await page.locator('#manage-count').textContent(), new RegExp(`${bundledCount + 10002} 条`));
      await page.locator('#restore-vocabulary').click();
      await page.locator('#accept-confirm').click();
      await page.locator('#library-status').filter({ hasText: '已恢复发布词库' }).waitFor();
      assert.match(await page.locator('#manage-count').textContent(), new RegExp(`${bundledCount} 条`));
    },
  );
  assert.deepEqual(errors, []);
  results.push('No browser JavaScript errors');
} catch (error) {
  await page.screenshot({ path: fileURLToPath(new URL('vocabulary-failure.png', out)) });
  throw error;
} finally {
  await writeFile(
    new URL('vocabulary-browser-report.json', out),
    JSON.stringify({ results, errors }, null, 2),
  );
  await browser.close();
}
