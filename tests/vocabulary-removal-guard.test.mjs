import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { toXLSX } from '../js/vocabulary-file.js';
import { normalizeRecord } from '../js/vocabulary-schema.js';
import {
  analyzeVocabularyChange,
  enforceRemovalGuard,
  importVocabulary,
} from '../tools/vocabulary-import.mjs';

const source = JSON.parse(
  await readFile(new URL('../data/vocabulary.json', import.meta.url), 'utf8'),
);
const additions = (count) =>
  Array.from({ length: count }, (_, index) =>
    normalizeRecord({ word: `防护测试新词${index}`, grade: 6 }).record,
  );

test('removal guard allows additions and small removals but blocks dangerous replacements', () => {
  const expanded = analyzeVocabularyChange(source, [...source, ...additions(36)]);
  assert.equal(expanded.current, source.length);
  assert.equal(expanded.imported, source.length + 36);
  assert.equal(expanded.added.length, 36);
  assert.equal(expanded.removed.length, 0);
  assert.equal(expanded.blocked, false);

  const unchanged = analyzeVocabularyChange(source, source);
  assert.equal(unchanged.imported, source.length);
  assert.equal(unchanged.unchanged, source.length);
  assert.equal(unchanged.blocked, false);

  const smallRemoval = analyzeVocabularyChange(source, source.slice(0, source.length - 4));
  assert.equal(smallRemoval.removed.length, 4);
  assert.equal(smallRemoval.blocked, false);

  const dangerousRemoval = analyzeVocabularyChange(source, source.slice(0, Math.floor(source.length / 2)));
  assert.equal(dangerousRemoval.removed.length, source.length - Math.floor(source.length / 2));
  assert.equal(dangerousRemoval.blocked, true);
  assert.throws(() => enforceRemovalGuard(dangerousRemoval), /Vocabulary update aborted/);

  const catastrophicRemoval = analyzeVocabularyChange(source, source.slice(0, 1));
  assert.equal(catastrophicRemoval.removed.length, source.length - 1);
  assert.equal(catastrophicRemoval.blocked, true);
  assert.throws(() => enforceRemovalGuard(catastrophicRemoval), /allow-removals/);
  assert.doesNotThrow(() => enforceRemovalGuard(catastrophicRemoval, { allowRemovals: true }));
});

test('blocked XLSX replacements leave the target dataset unchanged; override is explicit', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'vocabulary-removal-guard-'));
  const target = path.join(directory, 'vocabulary.json');
  const workbook = path.join(directory, 'truncated.xlsx');
  const report = path.join(directory, 'report.json');
  const backups = path.join(directory, 'backups');
  const before = JSON.stringify(source, null, 2) + '\n';
  try {
    await writeFile(target, before, 'utf8');
    await writeFile(workbook, new Uint8Array(await toXLSX([source[0]])));

    const options = {
      file: workbook,
      target,
      report,
      backupDirectory: backups,
      write: true,
      mode: 'replace',
      duplicates: 'update',
      confirmReplace: true,
    };
    await assert.rejects(importVocabulary(options), new RegExp(`would remove ${source.length - 1} records`));
    assert.equal(await readFile(target, 'utf8'), before);

    await importVocabulary({ ...options, allowRemovals: true });
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), [source[0]]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
