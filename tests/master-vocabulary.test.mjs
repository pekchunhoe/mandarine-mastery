import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readVocabularyFile } from '../js/vocabulary-file.js';
import { applyImport, previewRows } from '../js/vocabulary-schema.js';

const source = JSON.parse(
  await readFile(new URL('../data/vocabulary.json', import.meta.url), 'utf8'),
);

test('master workbook round-trips every runtime vocabulary record without loss', async () => {
  const rows = await readVocabularyFile(
    'master-vocabulary.xlsx',
    await readFile(new URL('../data/master-vocabulary.xlsx', import.meta.url)),
  );
  const preview = previewRows(rows, source);
  assert.equal(preview.counts.rows, source.length);
  assert.equal(preview.counts.existing, source.length);
  assert.equal(preview.counts.invalid, 0);
  assert.equal(preview.counts.incomplete, 0);
  assert.equal(preview.counts.duplicate, 0);

  const regenerated = applyImport(source, preview, { mode: 'replace', duplicates: 'update' });
  assert.deepEqual(regenerated, source);
  for (const { raw } of rows) {
    const record = regenerated.find((entry) => entry.id === raw.id);
    for (const field of ['generatedSynonyms', 'definitionChinese'])
      assert.equal(record[field], String(raw[field] ?? '').trim(), `${raw.id}: ${field}`);
  }
  assert.ok(regenerated.some((record) => record.generatedSynonyms.includes('、')));
  assert.ok(regenerated.some((record) => record.definitionChinese.includes('；')));
  assert.deepEqual(
    regenerated.map((record) => record.id),
    source.map((record) => record.id),
  );
  assert.deepEqual(
    regenerated.map((record) => record.exampleSentence),
    source.map((record) => record.exampleSentence),
  );
});
