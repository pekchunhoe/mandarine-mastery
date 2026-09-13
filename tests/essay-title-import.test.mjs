import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import * as XLSX from '../vendor/xlsx.mjs';
import {
  columns, contentColumns, countCompositionCharacters, enforceRemovalGuard, importEssayTitles, readEssayWorkbook,
} from '../tools/essay-title-import.mjs';

const makeWorkbook = async (directory, rows, name = 'titles.xlsx', contentRows = []) => {
  const contentRowsForWorkbook = contentRows.map((contentRow) =>
    contentRow[3] !== 'x'.repeat(149) && countCompositionCharacters(contentRow[3]) === 149
      ? [...contentRow.slice(0, 3), `${contentRow[3]}x`, ...contentRow.slice(4)]
      : contentRow);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([columns, ...rows]), 'EssayTitles');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([contentColumns, ...contentRowsForWorkbook]), 'EssayContents');
  const file = path.join(directory, name);
  await writeFile(file, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
  return file;
};
const row = (id, title = '难忘的一天') => [
  id, title, '', 3, '难忘经历', '难忘经历', '命题作文', 3, '', '经历；收获', '', '时间；经过；感受',
  'writing', '', '', 'true', 1, '',
];
const sampleContent = '清晨，天空刚刚亮起来，我和妈妈带着水壶来到社区花园。园里的向日葵迎着阳光点头，小鸟在树枝上唱歌。我们先捡起小路上的纸屑，再给花苗松土、浇水。汗水从额头流下来，可是看到花坛变得干净整齐，我一点也不觉得累。回家的路上，妈妈说爱护环境要从小事做起。我望着整洁的花园，心里像开了一朵花，也决定以后不乱丢垃圾，还要提醒朋友一起保护我们的家园。';
const legacyContentRow = (contentId, essayId, active = 'true', sortOrder = 1) => [
  contentId, essayId, '基础范文', sampleContent, '', 'basic', 'A', active, sortOrder, '',
];
const validSampleContent = `${sampleContent}x`;
const contentRow = (contentId, essayId, active = 'true', sortOrder = 1) => [
  contentId, essayId, 'base model', validSampleContent, '', 'basic', 'A', active, sortOrder, '',
];
const makeTitleOnlyWorkbook = async (directory, rows, name) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([columns, ...rows]), 'EssayTitles');
  const file = path.join(directory, name);
  await writeFile(file, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
  return file;
};

test('essay workbook imports Chinese records and retains stable IDs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'essay-title-import-'));
  const source = await makeWorkbook(directory, [row('essay-keep', '一次帮助别人的经历')]);
  const target = path.join(directory, 'essay-titles.json');
  const report = path.join(directory, 'report.json');
  await writeFile(target, JSON.stringify([{ id: 'essay-keep', title: '旧题目' }]));
  const result = await importEssayTitles({ file: source, target, report, backupDirectory: path.join(directory, 'backups') });
  assert.equal(result.records[0].id, 'essay-keep');
  assert.equal(result.records[0].title, '一次帮助别人的经历');
  assert.equal(JSON.parse(await readFile(target, 'utf8'))[0].title, '一次帮助别人的经历');
});

test('essay contents import with stable foreign keys, Unicode, multiple versions, and active filtering data', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'essay-content-import-'));
  const source = await makeWorkbook(directory, [row('essay-keep', '爱护花园')], 'contents.xlsx', [
    contentRow('essay-content-a', 'essay-keep', 'true', 2),
    contentRow('essay-content-b', 'essay-keep', 'false', 1),
  ]);
  const target = path.join(directory, 'essay-titles.json');
  const contentTarget = path.join(directory, 'essay-contents.json');
  await writeFile(target, JSON.stringify([{ id: 'essay-keep', title: '爱护花园' }]));
  await writeFile(contentTarget, '[]');
  const result = await importEssayTitles({ file: source, target, contentTarget, report: path.join(directory, 'report.json'), backupDirectory: path.join(directory, 'backups') });
  assert.equal(result.contents.length, 2);
  assert.equal(result.contents[0].essayId, 'essay-keep');
  assert.equal(result.contents[0].content, validSampleContent);
  assert.equal(result.contents[0].wordCount, countCompositionCharacters(validSampleContent));
  assert.equal(JSON.parse(await readFile(contentTarget, 'utf8'))[1].active, false);
});

test('essay contents reject invalid relationships and malformed records without changing either runtime dataset', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'essay-content-invalid-'));
  const target = path.join(directory, 'essay-titles.json');
  const contentTarget = path.join(directory, 'essay-contents.json');
  const beforeTitles = JSON.stringify([{ id: 'essay-keep', title: '保留' }]);
  const beforeContents = JSON.stringify([{ contentId: 'old-content', essayId: 'essay-keep' }]);
  await writeFile(target, beforeTitles); await writeFile(contentTarget, beforeContents);
  const orphan = await makeWorkbook(directory, [row('essay-keep', 'this title must not be written')], 'orphan.xlsx', [contentRow('new-content', 'essay-missing')]);
  await assert.rejects(importEssayTitles({ file: orphan, target, contentTarget, report: path.join(directory, 'report.json') }), /does not exist/);
  assert.equal(await readFile(target, 'utf8'), beforeTitles);
  assert.equal(await readFile(contentTarget, 'utf8'), beforeContents);
  const duplicate = await makeWorkbook(directory, [row('essay-keep', '保留')], 'duplicate-content.xlsx', [contentRow('same-content', 'essay-keep'), contentRow('same-content', 'essay-keep')]);
  await assert.rejects(importEssayTitles({ file: duplicate, target, contentTarget, report: path.join(directory, 'duplicate-report.json') }), /duplicate content_id/);
  const invalidActive = await makeWorkbook(directory, [row('essay-keep', '保留')], 'invalid-active.xlsx', [contentRow('active-content', 'essay-keep', 'maybe')]);
  await assert.rejects(importEssayTitles({ file: invalidActive, target, contentTarget, report: path.join(directory, 'active-report.json') }), /active must be true or false/);
  assert.equal(await readFile(target, 'utf8'), beforeTitles);
  assert.equal(await readFile(contentTarget, 'utf8'), beforeContents);
});

test('essay contents require their worksheet and full schema, preserving runtime data on failure', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'essay-content-schema-'));
  const target = path.join(directory, 'essay-titles.json'), contentTarget = path.join(directory, 'essay-contents.json');
  const beforeTitles = JSON.stringify([{ id: 'essay-keep', title: '保留' }]), beforeContents = JSON.stringify([{ contentId: 'keep-content', essayId: 'essay-keep' }]);
  await writeFile(target, beforeTitles); await writeFile(contentTarget, beforeContents);
  const missingSheet = await makeTitleOnlyWorkbook(directory, [row('essay-keep', '保留')], 'missing-sheet.xlsx');
  await assert.rejects(importEssayTitles({ file: missingSheet, target, contentTarget, report: path.join(directory, 'sheet-report.json') }), /Missing required worksheet: EssayContents/);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([columns, row('essay-keep', '保留')]), 'EssayTitles');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([contentColumns.slice(0, -1)]), 'EssayContents');
  const missingColumn = path.join(directory, 'missing-column.xlsx');
  await writeFile(missingColumn, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
  await assert.rejects(importEssayTitles({ file: missingColumn, target, contentTarget, report: path.join(directory, 'column-report.json') }), /missing required columns: notes/);
  assert.equal(await readFile(target, 'utf8'), beforeTitles);
  assert.equal(await readFile(contentTarget, 'utf8'), beforeContents);
});

test('essay contents reject blank IDs/content and malformed numeric fields while preserving multiline Unicode', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'essay-content-fields-'));
  const target = path.join(directory, 'essay-titles.json'), contentTarget = path.join(directory, 'essay-contents.json');
  const beforeTitles = JSON.stringify([{ id: 'essay-keep', title: '保留' }]), beforeContents = '[]';
  await writeFile(target, beforeTitles); await writeFile(contentTarget, beforeContents);
  const blankId = contentRow('', 'essay-keep');
  const blankContent = contentRow('blank-content', 'essay-keep'); blankContent[3] = '';
  const badNumber = contentRow('bad-number', 'essay-keep'); badNumber[8] = 'first';
  for (const [name, rows, pattern] of [
    ['blank-id', [blankId], /content_id cannot be blank/],
    ['blank-content', [blankContent], /content cannot be blank/],
    ['bad-number', [badNumber], /sort_order must be an integer/],
  ]) {
    const source = await makeWorkbook(directory, [row('essay-keep', '保留')], `${name}.xlsx`, rows);
    await assert.rejects(importEssayTitles({ file: source, target, contentTarget, report: path.join(directory, `${name}.json`) }), pattern);
  }
  const multiline = contentRow('multiline-content', 'essay-keep'); multiline[3] = sampleContent.replace('回家的路上', '\n回家的路上');
  const valid = await makeWorkbook(directory, [row('essay-keep', '保留')], 'multiline.xlsx', [multiline]);
  await importEssayTitles({ file: valid, target, contentTarget, report: path.join(directory, 'valid.json'), backupDirectory: path.join(directory, 'backups') });
  assert.match(JSON.parse(await readFile(contentTarget, 'utf8'))[0].content, /\n回家的路上/);
});

test('essay contents outside the 150–600 allowed range are rejected before either runtime dataset changes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'essay-content-length-'));
  const target = path.join(directory, 'essay-titles.json'), contentTarget = path.join(directory, 'essay-contents.json');
  const beforeTitles = JSON.stringify([{ id: 'essay-keep', title: 'retained' }]);
  const beforeContents = JSON.stringify([{ contentId: 'keep-content', essayId: 'essay-keep' }]);
  await writeFile(target, beforeTitles); await writeFile(contentTarget, beforeContents);
  const tooShort = contentRow('short-content', 'essay-keep'); tooShort[3] = 'x'.repeat(149);
  const source = await makeWorkbook(directory, [row('essay-keep', 'retained')], 'too-short.xlsx', [tooShort]);
  await assert.rejects(importEssayTitles({ file: source, target, contentTarget, report: path.join(directory, 'report.json') }), /outside the allowed 150–600 range/);
  assert.equal(await readFile(target, 'utf8'), beforeTitles);
  assert.equal(await readFile(contentTarget, 'utf8'), beforeContents);
});

test('essay importer rejects malformed titles and duplicate IDs without altering runtime data', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'essay-title-invalid-'));
  const target = path.join(directory, 'essay-titles.json');
  const before = JSON.stringify([{ id: 'essay-existing', title: '保留' }]);
  await writeFile(target, before);
  const duplicate = await makeWorkbook(directory, [row('essay-1'), row('essay-1', '另一个题目')]);
  await assert.rejects(importEssayTitles({ file: duplicate, target, report: path.join(directory, 'report.json') }), /duplicate id/);
  assert.equal(await readFile(target, 'utf8'), before);
  const blankTitle = await makeWorkbook(directory, [row('essay-2', '')], 'blank.xlsx');
  await assert.rejects(readEssayWorkbook(blankTitle).then((rows) => importEssayTitles({ file: blankTitle, target, report: path.join(directory, 'blank-report.json') })), /title cannot be blank/);
  assert.equal(await readFile(target, 'utf8'), before);
});

test('essay importer rejects malformed rows with an implicit extra column', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'essay-title-malformed-'));
  const target = path.join(directory, 'essay-titles.json');
  const before = JSON.stringify([{ id: 'essay-existing', title: '保留' }]);
  await writeFile(target, before);
  const malformed = await makeWorkbook(directory, [[...row('essay-3'), 'unexpected cell']], 'malformed.xlsx');
  await assert.rejects(importEssayTitles({ file: malformed, target, report: path.join(directory, 'report.json') }), /blank column name/);
  assert.equal(await readFile(target, 'utf8'), before);
});

test('essay deletion guard blocks large replacements until explicitly overridden', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'essay-title-removal-'));
  const target = path.join(directory, 'essay-titles.json');
  const existing = Array.from({ length: 12 }, (_, index) => ({ id: `essay-${index}`, title: `题目${index}` }));
  const before = JSON.stringify(existing);
  await writeFile(target, before);
  const source = await makeWorkbook(directory, [row('essay-0')]);
  await assert.rejects(importEssayTitles({ file: source, target, report: path.join(directory, 'report.json') }), /would be removed/);
  assert.equal(await readFile(target, 'utf8'), before);
  const result = await importEssayTitles({ file: source, target, report: path.join(directory, 'override-report.json'), backupDirectory: path.join(directory, 'backups'), allowRemovals: true });
  assert.equal(result.change.removed.length, 11);
  assert.doesNotThrow(() => enforceRemovalGuard(result.change, { allowRemovals: true }));
});

test('essay-content deletion guard blocks a bulk removal until explicitly overridden', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'essay-content-removal-'));
  const target = path.join(directory, 'essay-titles.json');
  const contentTarget = path.join(directory, 'essay-contents.json');
  await writeFile(target, JSON.stringify([{ id: 'essay-keep', title: '保留' }]));
  const existing = Array.from({ length: 12 }, (_, index) => ({ contentId: `content-${index}`, essayId: 'essay-keep', active: true }));
  const before = JSON.stringify(existing);
  await writeFile(contentTarget, before);
  const source = await makeWorkbook(directory, [row('essay-keep', '保留')], 'removal.xlsx', [contentRow('content-0', 'essay-keep')]);
  await assert.rejects(importEssayTitles({ file: source, target, contentTarget, report: path.join(directory, 'report.json') }), /would be removed/);
  assert.equal(await readFile(contentTarget, 'utf8'), before);
  const result = await importEssayTitles({ file: source, target, contentTarget, report: path.join(directory, 'override-report.json'), backupDirectory: path.join(directory, 'backups'), allowRemovals: true });
  assert.equal(result.contentChange.removed.length, 11);
});
