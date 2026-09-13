import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  sentenceChunks,
  practiceExample,
  editorial,
  builders,
  expansions,
  distractors,
  paragraphs,
} from '../data/content.js';
const originalRows = JSON.parse(
  await readFile(new URL('../docs/archive/vocabulary-original.json', import.meta.url), 'utf8'),
);
const rows = originalRows;
const canonical = JSON.parse(
  await readFile(new URL('../data/vocabulary.json', import.meta.url), 'utf8'),
);
const words = canonical
  .filter((w) => originalRows.some((r) => r.words.some((x) => x.id === w.id)))
  .map((w) => ({ ...w, example: w.exampleSentence }));
test('Workbook preserves 188 source characters and 564 vocabulary relationships', () => {
  assert.equal(rows.length, 188);
  assert.equal(words.length, 564);
  assert.equal(rows.filter((r) => r.grade === 3).length, 79);
  assert.equal(words.filter((r) => r.grade === 3).length, 237);
  assert.equal(words.filter((r) => r.grade === 4).length, 327);
  assert.equal(new Set(words.map((w) => w.id)).size, 564);
});
test('Every source relationship and reference sentence is internally consistent', () => {
  for (const w of words) {
    assert.ok(w.word.includes(w.character), w.id);
    assert.ok(w.example.includes(w.word), w.id);
    assert.equal(w.id, `${w.grade}-${w.character}-${w.word}`);
    assert.equal(typeof w.example, 'string');
    assert.ok(!/undefined|NaN/.test(w.example));
  }
});
test('Lesson metadata and duplicate source relationships are preserved', () => {
  assert.ok(words.filter((w) => w.grade === 3).every((w) => w.lesson === null));
  assert.equal(new Set(words.filter((w) => w.grade === 4).map((w) => w.lesson)).size, 20);
  assert.equal(words.filter((w) => w.grade === 3 && w.word === '钥匙').length, 2);
  assert.equal(words.filter((w) => w.grade === 4 && w.word === '仓库').length, 2);
});
test('All eligible phrase puzzles reconstruct the exact teaching sentence', () => {
  let eligible = 0;
  for (const word of words) {
    const chunks = sentenceChunks(word);
    if (!chunks) continue;
    eligible++;
    assert.ok(chunks.length >= 2);
    assert.equal(chunks.join(''), practiceExample(word), word.id);
    assert.ok(chunks.every((x) => x.length > 0));
  }
  assert.ok(eligible > 300, `${eligible} eligible`);
  console.log(
    `Phrase puzzle coverage: ${eligible}/564 sources; remainder use explicit sentence writing.`,
  );
});
test('Cloze removes only complete target words and every override keeps its target', () => {
  for (const w of words) {
    const text = practiceExample(w);
    assert.ok(text.includes(w.word));
    assert.equal(text.split(w.word).join('____').split('____').join(w.word), text);
  }
  for (const [word, note] of Object.entries(editorial)) {
    assert.ok(words.some((w) => w.word === word));
    assert.ok(note.example.includes(word));
  }
});
test('All curated components and distractors refer to source vocabulary', () => {
  const set = new Set(words.map((w) => w.word));
  for (const word of [
    ...Object.keys(builders),
    ...Object.keys(expansions),
    ...Object.keys(distractors),
  ])
    assert.ok(set.has(word), word);
  for (const [word, list] of Object.entries(distractors)) {
    assert.ok(!list.includes(word));
    for (const w of list) assert.ok(set.has(w), w);
  }
  for (const [word, b] of Object.entries(builders)) {
    assert.ok(
      b.action.every((a) => a.includes(word)),
      word,
    );
  }
  for (const p of paragraphs) assert.ok(p.sentences.length >= 3 && p.sentences.length <= 5);
});
test('No prohibited metalinguistic sentence templates are introduced', () => {
  for (const w of words)
    assert.ok(
      !/我今天学习了|老师教我们.*词语|老师请我们用|我在阅读时看到/.test(practiceExample(w)),
      w.id,
    );
});
test('Phrase splitting never detaches possessive or plural suffixes', () => {
  for (const w of words) {
    const chunks = sentenceChunks(w);
    if (chunks)
      assert.ok(
        chunks.every((c) => !/^[的们]/.test(c)),
        w.id,
      );
  }
  assert.deepEqual(sentenceChunks(words.find((w) => w.word === '扣子')), [
    '我的校服',
    '掉了一颗扣子。',
  ]);
});

test('Migration preserves every original sentence and stable ID verbatim', () => {
  for (const r of originalRows)
    for (const old of r.words) {
      const w = canonical.find((x) => x.id === old.id);
      assert.ok(w);
      assert.equal(w.exampleSentence, old.example);
      assert.equal(w.word, old.word);
      assert.equal(w.grade, r.grade);
      assert.equal(w.lesson, r.lesson);
      assert.equal(w.character, r.character);
    }
});
