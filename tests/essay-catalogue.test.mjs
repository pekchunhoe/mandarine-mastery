import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titles, contents, legacyIds, added, samples, distribution, modelFor } from './essay-catalogue-fixtures.mjs';
import { getEssayTitles, getEssayTitleById } from '../js/essay-title-service.js';
import { getActiveEssayContentsByEssayId, getEssayContentById } from '../js/essay-content-service.js';

test('workbook-to-runtime joined catalogue retains every new ID, including blank optional metadata', () => {
  const joined = getEssayTitles().filter((title) => getActiveEssayContentsByEssayId(title.id).length);
  assert.equal(joined.length, 1000);
  assert.equal(new Set(joined.map((title) => title.id)).size, 1000);
  assert.deepEqual(joined, titles);
  assert.equal(contents.length, 1000);
  assert.equal(added.length, 700);
  for (const title of added) {
    assert.equal(legacyIds.has(title.id), false);
    assert.deepEqual(title.suggestedKeywords, []);
    assert.deepEqual(title.writingGuidance, []);
    assert.equal(title.titlePinyin, '');
    assert.deepEqual(getEssayTitleById(title.id), title);
    const model = modelFor(title);
    assert.deepEqual(getEssayContentById(model.contentId), model);
    assert.deepEqual(getActiveEssayContentsByEssayId(title.id), [model]);
  }
  for (const [grade, count] of Object.entries(distribution)) {
    assert.equal(joined.filter((title) => title.grade === Number(grade)).length, count);
  }
  assert.ok(samples.every((title) => !legacyIds.has(title.id)));
});
