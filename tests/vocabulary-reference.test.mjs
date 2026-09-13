import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVocabularyService } from '../js/vocabulary-service.js';
import { normalizeRecord, previewRows, applyImport } from '../js/vocabulary-schema.js';
import { toXLSX, readVocabularyFile } from '../js/vocabulary-file.js';
import { vocabularyDetails } from '../components/vocabulary-details.js';

const records = JSON.parse(await readFile(new URL('../data/vocabulary.json', import.meta.url), 'utf8'));
const service = createVocabularyService(records);
test('published workbook synonyms and definition substrings find the requested words', () => {
  for (const query of ['庞大', ' 宏大 ', '硕大'])
    assert.ok(service.searchWords(query).some((word) => word.word === '巨大'), query);
  assert.ok(service.searchWords('石头').some((word) => word.word === '巨石'));
  assert.ok(service.searchWords('非常大').some((word) => word.word === '巨大'));
  assert.equal(service.searchWords('巨大')[0].word, '巨大');
  assert.equal(service.searchWords(' ').length, records.length);
  assert.equal(service.searchWords(null).length, records.length);
  assert.deepEqual(service.searchWords('zzzz-no-result-zzzz'), []);
});
test('ranked search preserves filters, metadata, Latin case and tone-insensitive pinyin', () => {
  const base = { grade: 3 };
  const search = createVocabularyService([
    { ...base, word: '释义匹配', definitionChinese: '庞大', meaningEnglish: 'Enormous', tags: ['测试'] },
    { ...base, word: '拼音匹配', pinyin: 'páng dà' },
    { ...base, word: '部分近义词', generatedSynonyms: '很庞大' },
    { ...base, word: '完整近义词', generatedSynonyms: '宏大,庞大；硕大 巨型|大个，巨大/大' },
    { ...base, word: '庞大的' },
    { ...base, word: '庞大' },
    { grade: 4, word: '空白词' },
  ]);
  assert.deepEqual(search.searchWords('庞大').map((w) => w.word), ['庞大', '庞大的', '完整近义词', '部分近义词', '释义匹配']);
  for (const term of ['宏大', '硕大', '巨型', '大个', '巨大'])
    assert.equal(search.searchWords(term)[0].word, '完整近义词');
  assert.equal(search.searchWords(' PANG DA ')[0].word, '拼音匹配');
  assert.equal(search.searchWords('ÉNORMOUS')[0].word, '释义匹配');
  assert.equal(search.searchWords('测试')[0].word, '释义匹配');
  assert.deepEqual(search.searchWords('庞大', { grade: 4 }), []);
  assert.equal(search.searchWords('', { grade: 4 })[0].word, '空白词');
  search.setWords([{ ...base, word: '新词', generatedSynonyms: '更新' }]);
  assert.equal(search.searchWords('更新')[0].word, '新词');
  assert.deepEqual(search.searchWords('庞大'), []);
});
test('Excel round trip retains new Unicode strings, all old fields, IDs and added rows', async () => {
  const old = records.slice(0, 3);
  const added = normalizeRecord({ id: 'reference-fixture', word: '测试词', grade: 6,
    generatedSynonyms: '甲、乙，丙；丁', definitionChinese: '第一层意思；第二层意思。', exampleSentence: '  原句。\n' }).record;
  const next = [...old, added];
  const rows = await readVocabularyFile('reference.xlsx', await toXLSX(next));
  const preview = previewRows(rows, old);
  assert.equal(preview.counts.new, 1);
  assert.equal(preview.counts.existing, old.length);
  assert.deepEqual(applyImport(old, preview, { mode: 'replace', duplicates: 'update' }), next);
});
test('reference renderer handles missing fields and escapes student-facing text', () => {
  const empty = vocabularyDetails({ word: '空白', pinyin: null, generatedSynonyms: undefined, definitionChinese: {}, exampleSentence: '' });
  assert.doesNotMatch(empty, /undefined|null|\[object Object\]/);
  assert.equal((empty.match(/<dd>—<\/dd>/g) || []).length, 4);
  const rendered = vocabularyDetails({ word: '<词>', generatedSynonyms: '甲、乙', definitionChinese: '<script>；释义', exampleSentence: '原句。' });
  assert.ok(rendered.includes('甲、乙'));
  assert.ok(rendered.includes('&lt;script&gt;；释义'));
  assert.ok(rendered.includes('data-speak="&lt;词&gt;"'));
});
