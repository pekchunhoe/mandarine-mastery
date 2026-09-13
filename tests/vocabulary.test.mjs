import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeRecord,
  gradeNumber,
  previewRows,
  applyImport,
  fields,
} from '../js/vocabulary-schema.js';
import { createVocabularyService } from '../js/vocabulary-service.js';
import { readVocabularyFile, toCSV, toXLSX, parseCSV } from '../js/vocabulary-file.js';
import { overlayWords, exportRecords } from '../js/vocabulary-store.js';
import { practiceExample } from '../data/content.js';
import * as XLSX from '../vendor/xlsx.mjs';
import { aggregate, emptyRecord, recordAttempt } from '../js/mastery.js';
import { freshState } from '../js/storage.js';
const raw = {
  word: '图书馆',
  grade: 3,
  pinyin: 'tú shū guǎn',
  meaningEnglish: 'library',
  meaningMalay: 'perpustakaan',
  category: '学校',
  difficulty: 2,
  exampleSentence: '  放学后，我和姐姐一起到图书馆看书。\n',
  tags: ['学校', '阅读'],
  essayTopics: ['我的学校', '阅读'],
  collocations: ['到图书馆看书'],
  synonyms: [],
  antonyms: [],
};
const word = normalizeRecord(raw).record;
const data = JSON.parse(
  await readFile(new URL('../data/vocabulary.json', import.meta.url), 'utf8'),
);
test('Chinese aliases, grade variants, arrays, optional values and sentence fidelity', () => {
  for (const value of ['3', 'Year 3', '三年级', '3年级', 'Tahun 3'])
    assert.equal(gradeNumber(value), 3);
  for (const value of ['0', 'Year 9', '七年级', '3.5']) assert.equal(gradeNumber(value), null);
  const n = normalizeRecord({
    词语: ' 图书馆 ',
    年级: '三年级',
    例句: raw.exampleSentence,
    标签: '学校;阅读',
    作文主题: '我的学校；阅读',
    搭配: '到图书馆看书',
  }).record;
  assert.equal(n.word, '图书馆');
  assert.equal(n.exampleSentence, raw.exampleSentence);
  assert.deepEqual(n.tags, raw.tags);
  assert.deepEqual(n.essayTopics, raw.essayTopics);
  assert.equal(normalizeRecord({ word: '学习', grade: 1 }).record.exampleSentence, '');
});
test('Generated IDs survive sorting, export and insertion; explicit IDs preserved', () => {
  const records = [raw, { word: '勇敢', grade: 4 }];
  const before = previewRows(records).entries.map((x) => x.record);
  const after = previewRows([...records].reverse()).entries.map((x) => x.record);
  for (const w of before) assert.equal(w.id, after.find((x) => x.word === w.word).id);
  assert.equal(normalizeRecord({ ...raw, id: 'teacher-17' }).record.id, 'teacher-17');
  assert.throws(() => normalizeRecord({ ...raw, id: 'bad\u0000id' }), /Malformed ID/);
});
test('Preview classifies empty, invalid, duplicate, existing and cross-year rows', () => {
  const p = previewRows(
    [
      raw,
      {},
      { word: '', grade: 3 },
      { word: '天空', grade: 9 },
      { ...raw, grade: 4 },
      { ...raw, grade: 4 },
      { word: '安全', grade: 2, id: word.id },
    ],
    [word],
  );
  assert.equal(p.counts.rows, 6);
  assert.equal(p.counts.existing, 1);
  assert.equal(p.counts.new, 1);
  assert.equal(p.counts.incomplete, 1);
  assert.equal(p.counts.invalid, 2);
  assert.equal(p.counts.duplicate, 1);
  assert.equal(p.counts.crossGrade, 1);
  assert.match(p.entries.at(-1).reason, /different word/);
});
test('Same-year original character relationships survive export/reimport and ambiguity is reported', () => {
  const preview = previewRows(data, data);
  assert.equal(preview.counts.existing, data.length);
  assert.equal(preview.counts.invalid, 0);
  assert.equal(preview.counts.duplicate, 0);
  const ambiguous = previewRows([{ word: '钥匙', grade: 3 }], data);
  assert.equal(ambiguous.counts.invalid, 1);
  const conflict = previewRows([{ ...raw, id: 'another-id' }], [word]);
  assert.equal(conflict.counts.invalid, 1);
});
test('Merge, skip, partial update and replacement never mutate source and retain IDs', () => {
  const update = previewRows(
    [
      { word: '图书馆', grade: 3, meaningMalay: 'perpustakaan baru' },
      { word: '天空', grade: 1 },
    ],
    [word],
  );
  const skipped = applyImport([word], update);
  assert.equal(skipped.length, 2);
  assert.equal(skipped[0].meaningMalay, raw.meaningMalay);
  const changed = applyImport([word], update, { duplicates: 'update' });
  assert.equal(changed[0].id, word.id);
  assert.equal(changed[0].pinyin, raw.pinyin);
  assert.equal(changed[0].meaningMalay, 'perpustakaan baru');
  assert.equal(word.meaningMalay, raw.meaningMalay);
  assert.equal(
    applyImport([word], previewRows([{ word: '天空', grade: 1 }], [word]), { mode: 'replace' })
      .length,
    1,
  );
});
test('Service combines filters, searches Mandarin/pinyin/English/Malay and samples unique IDs', () => {
  const service = createVocabularyService([
    word,
    { word: '勇敢', grade: 4, category: '品德', difficulty: 3 },
    { word: '空白', grade: 1 },
  ]);
  for (const q of ['图书', 'tu shu guan', 'library', 'perpustakaan', '阅读'])
    assert.equal(service.searchWords(q)[0].id, word.id);
  assert.equal(
    service.query({
      grade: 3,
      category: '学校',
      difficulty: 2,
      tag: '阅读',
      essayTopic: '我的学校',
    }).length,
    1,
  );
  assert.equal(service.query({ grade: 4, category: '学校' }).length, 0);
  assert.equal(service.getRandomWords({ grade: 3, count: 50 }).length, 1);
  assert.equal(service.getRandomWords({ count: 0 }).length, 0);
  assert.equal(service.getWordById(word.id).id, word.id);
  assert.equal(service.getAllWords().length, 3);
  assert.throws(() => service.getAllWords().push(word));
});
test('Missing optional examples never create artificial sentences or corrupt blank metadata', () => {
  const n = normalizeRecord({ word: '学习', grade: 1 }).record;
  const service = createVocabularyService([n]);
  assert.equal(practiceExample(service.getAllWords()[0]), '');
  assert.deepEqual(exportRecords(service.getAllWords()), [n]);
  const original = data.find((w) => w.word === '山谷');
  assert.equal(
    practiceExample({ ...original, exampleSentence: '我们在山谷里发现了一条小溪。' }),
    '我们在山谷里发现了一条小溪。',
  );
});
test('Teacher overlay rebases on new deployed records and rejects corruption', () => {
  const extra = normalizeRecord({ word: '天空', grade: 2 }).record;
  assert.deepEqual(
    overlayWords([word, extra], {
      version: 1,
      upserts: [{ ...word, pinyin: 'local' }],
      deleted: [],
    }).map((w) => w.pinyin),
    ['local', ''],
  );
  assert.equal(
    overlayWords([word, extra], { version: 1, upserts: [], deleted: [word.id] }).length,
    1,
  );
  assert.throws(() => overlayWords(data, { version: 99 }));
  assert.throws(() => overlayWords(data, { version: 1, upserts: [word, word], deleted: [] }));
});
test('CSV and JSON round-trip every field, Chinese punctuation, multiline quotes and formula-like text', async () => {
  const original = {
    ...word,
    meaningEnglish: 'a "quoted", library',
    source: '=not a formula',
    sentencePinyin: 'line one\nline two',
    collocations: ['a;b', '词语、原文'],
  };
  for (const [name, content] of [
    ['words.csv', toCSV([original])],
    ['words.json', JSON.stringify([original])],
  ]) {
    const p = previewRows(await readVocabularyFile(name, Buffer.from(content, 'utf8')));
    assert.equal(p.counts.new, 1);
    assert.deepEqual(p.entries[0].record, original);
  }
  assert.ok(!parseCSV(toCSV([original]))[1].includes('=not a formula'));
});
test('XLSX and legacy XLS parse, export, and round-trip with Chinese headings', async () => {
  const bytes = await toXLSX([word]);
  const result = previewRows(await readVocabularyFile('words.xlsx', bytes));
  assert.deepEqual(result.entries[0].record, word);
  for (const bookType of ['xlsx', 'biff8']) {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['词语', '年级', '例句', '标签'],
        ['图书馆', '三年级', raw.exampleSentence, '学校;阅读'],
        [],
        ['天空', 'Year 2', '', ''],
      ]),
      '词语',
    );
    const p = previewRows(
      await readVocabularyFile(
        bookType === 'xlsx' ? 'a.xlsx' : 'a.xls',
        XLSX.write(book, { type: 'array', bookType }),
      ),
    );
    assert.equal(p.counts.new, 2);
    assert.equal(p.counts.rows, 2);
    assert.equal(p.entries[0].record.word, '图书馆');
    assert.equal(p.entries[0].record.exampleSentence, raw.exampleSentence);
  }
});
test('Malformed CSV/JSON/workbook, missing columns, empty sheets, formulas and invalid arrays fail clearly', async () => {
  assert.equal(
    previewRows([null, 42, [], { word: '词语', grade: 3, id: '__proto__' }]).counts.invalid,
    4,
  );
  for (const [name, text] of [
    ['a.csv', 'word,grade\n"oops,3'],
    ['a.csv', 'word,grade\n词语,3,extra'],
    ['a.csv', '拼音,标签\npin,tag'],
    ['a.json', '{'],
    ['a.json', '{}'],
    ['a.xlsx', 'not a workbook'],
    ['a.xls', 'not a workbook'],
  ])
    await assert.rejects(readVocabularyFile(name, Buffer.from(text)));
  assert.equal((await readVocabularyFile('a.csv', Buffer.from('word,grade\n\n'))).length, 1);
  const p = previewRows([
    { word: '词语', grade: 3, tags: '[bad]' },
    { word: '词语', grade: 3, difficulty: '9' },
    { word: '词语', grade: 3, tags: [42] },
  ]);
  assert.equal(p.counts.invalid, 3);
  const book = XLSX.utils.book_new(),
    sheet = XLSX.utils.aoa_to_sheet([
      ['word', 'grade'],
      ['词语', 3],
    ]);
  sheet.A2 = { t: 's', f: '"词语"', v: '词语' };
  XLSX.utils.book_append_sheet(book, sheet, 'Sheet');
  await assert.rejects(
    readVocabularyFile('a.xlsx', XLSX.write(book, { type: 'array', bookType: 'xlsx' })),
    /formulas/,
  );
});
test('10,000 records validate, index, filter, sample and export without lost IDs', async () => {
  const raw = Array.from({ length: 10000 }, (_, i) => ({
    word: '词语' + i,
    grade: (i % 6) + 1,
    category: i % 2 ? '学校' : '家庭',
    tags: ['阅读'],
    essayTopics: ['我的学校'],
  }));
  const started = performance.now(),
    p = previewRows(raw);
  assert.equal(p.counts.new, 10000);
  const service = createVocabularyService(p.entries.map((x) => x.record));
  assert.equal(service.getAllWords().length, 10000);
  assert.equal(service.getWordsByGrade(1).length, 1667);
  const random = service.getRandomWords({ grade: 2, tag: '阅读', count: 1000 });
  assert.equal(random.length, 1000);
  assert.equal(new Set(random.map((w) => w.id)).size, 1000);
  const parsed = previewRows(
    await readVocabularyFile('large.csv', Buffer.from(toCSV(exportRecords(service.getAllWords())))),
  );
  assert.equal(parsed.counts.new, 10000);
  console.log(
    `10,000-row validation, indexing, filtering and CSV round trip: ${Math.round(performance.now() - started)} ms`,
  );
});
test('Teacher CSV template has the complete schema and valid sample rows', async () => {
  const p = previewRows(
    await readVocabularyFile(
      'template.csv',
      await readFile(new URL('../templates/vocabulary-template.csv', import.meta.url)),
    ),
  );
  assert.equal(p.counts.new, 3);
  assert.equal(p.counts.invalid, 0);
  for (const x of p.entries) for (const f of fields) assert.ok(f in x.record);
});
test('10,000 learned words aggregate efficiently and later practice remains live', () => {
  const state = freshState();
  for (let i = 0; i < 10000; i++)
    state.records['test-' + i] = {
      ...emptyRecord('测试词语' + i),
      seen: 1,
      correct: 1,
      recognition: 1,
    };
  const started = performance.now();
  for (let i = 0; i < 10000; i++) assert.equal(aggregate(state, '测试词语' + i).seen, 1);
  console.log(`10,000 learned-word summaries: ${Math.round(performance.now() - started)} ms`);
  recordAttempt(state, { id: 'test-new-source', word: '测试词语0' }, 'recall', true, {
    answer: '测试词语0',
  });
  assert.equal(aggregate(state, '测试词语0').seen, 2);
  state.records['test-new-source'].due = '2030-01-01T00:00:00.000Z';
  assert.equal(aggregate(state, '测试词语0').due, '2030-01-01T00:00:00.000Z');
});
