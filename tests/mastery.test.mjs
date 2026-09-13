import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshState, hydrate, loadState, saveState, STORAGE_KEY } from '../js/storage.js';
import {
  recordAttempt,
  aggregate,
  reviewQueue,
  calculateMastery,
  emptyRecord,
  streak,
} from '../js/mastery.js';
import { dayKey } from '../js/utils.js';
const item = { id: '4-沟-沟通', word: '沟通' },
  now = new Date('2026-09-10T10:00:00Z');
test('Recognition repetition cannot unlock production mastery', () => {
  const s = freshState();
  for (let i = 0; i < 100; i++)
    recordAttempt(s, item, 'recognition', true, { answer: String(i), now });
  assert.equal(s.records[item.id].mastery, 24);
  assert.equal(s.records[item.id].sentenceSuccess, 0);
});
test('Repeated answers across duplicate source characters earn credit once', () => {
  const s = freshState();
  recordAttempt(s, { id: '3-钥-钥匙', word: '钥匙' }, 'recall', true, { answer: '钥匙', now });
  const next = recordAttempt(s, { id: '3-匙-钥匙', word: '钥匙' }, 'recall', true, {
    answer: '钥匙',
    now,
  });
  assert.ok(next.duplicate);
  assert.equal(s.xp, 7);
  assert.equal(aggregate(s, '钥匙').correct, 1);
});
test('Production weighs more; automatic evidence remains capped below human mastery', () => {
  const s = freshState();
  for (let i = 0; i < 8; i++) {
    recordAttempt(s, item, 'recall', true, { answer: `r${i}`, now });
    recordAttempt(s, item, 'sentence', true, { answer: `s${i}`, now });
    recordAttempt(s, item, 'paragraph', true, { answer: `p${i}`, now });
  }
  assert.equal(aggregate(s, '沟通').mastery, 89);
  recordAttempt(s, item, 'reviewed', true, { answer: 'teacher read this paragraph', now });
  assert.equal(aggregate(s, '沟通').mastery, 100);
});
test('Human review alone cannot grant final mastery without recall and sentence evidence', () => {
  const r = emptyRecord('词');
  Object.assign(r, { correct: 50, paragraphSuccess: 10, reviewed: 10 });
  assert.ok(calculateMastery(r) < 90);
});
test('Hints reduce XP without erasing successful practice', () => {
  const s = freshState();
  const result = recordAttempt(s, item, 'recall', true, { answer: '沟通', hint: 3, now });
  assert.equal(result.xp, 4);
  assert.equal(result.record.recall, 1);
  assert.ok(result.record.mastery > 0);
});
test('Review prioritizes recent errors and includes stable easier words', () => {
  const s = freshState(),
    items = [item, ...Array.from({ length: 8 }, (_, i) => ({ id: `w${i}`, word: `词${i}` }))];
  recordAttempt(s, item, 'recall', false, { answer: '错', now });
  for (const other of items.slice(4))
    s.records[other.id] = {
      ...emptyRecord(other.word),
      correct: 20,
      recall: 5,
      sentenceSuccess: 4,
      mastery: 84,
      lastPractised: '2026-08-01T00:00:00Z',
      due: '2026-08-08T00:00:00Z',
    };
  const queue = reviewQueue(items, s, 6, now);
  assert.equal(queue[0].id, item.id);
  assert.ok(queue.some((w) => w.id === 'w3'));
  assert.equal(new Set(queue.map((w) => w.word)).size, queue.length);
});
test('Storage recovery handles corrupted nested values and unavailable storage', () => {
  const raw = {
    version: 1,
    settings: { grade: 'bad', count: 'bad', difficulty: 'impossible' },
    records: { broken: null, ok: { word: '词', mastery: 'nope' } },
    drafts: { bad: null },
    xp: 'bad',
  };
  const result = hydrate(raw);
  assert.equal(result.settings.grade, '3');
  assert.equal(result.xp, 0);
  assert.equal(result.records.ok.mastery, 0);
  const store = {
    getItem: () => '{broken',
    setItem() {
      throw Error('denied');
    },
  };
  assert.deepEqual(loadState(store), freshState());
  assert.equal(saveState(freshState(), store), false);
});
test('Refresh round-trip retains progress and drafts; reset state is separate', () => {
  const s = freshState();
  recordAttempt(s, item, 'sentence', true, { answer: '我们耐心沟通，终于解决了误会。', now });
  s.drafts.essay = { text: '我的故事', kind: 'essay' };
  const map = new Map(),
    store = { setItem: (k, v) => map.set(k, v), getItem: (k) => map.get(k) };
  assert.ok(saveState(s, store));
  assert.equal(loadState(store).drafts.essay.text, '我的故事');
  assert.equal(loadState(store).xp, 14);
  const reset = freshState();
  assert.equal(reset.xp, 0);
  assert.equal(loadState(store).xp, 14);
  assert.ok(map.has(STORAGE_KEY));
});
test('Streak tolerates yesterday but never a missed full day', () => {
  const date = new Date(2026, 8, 10, 12);
  assert.equal(streak(['2026-09-08', '2026-09-09'], date), 2);
  assert.equal(streak(['2026-09-08'], date), 0);
});
test('A successfully corrected word no longer monopolizes the review queue', () => {
  const s = freshState();
  const earlier = new Date(now.getTime() - 60000);
  recordAttempt(s, item, 'recall', false, { answer: '错', now: earlier });
  recordAttempt(s, item, 'recall', true, { answer: '沟通', now });
  const other = { id: 'new', word: '新词' };
  assert.equal(reviewQueue([item, other], s, 2, now)[0].id, 'new');
});
test('Malformed dates and draft internals are sanitized before rendering', () => {
  const result = hydrate({
    version: 1,
    records: { x: { word: '词', lastPractised: 42, due: 'invalid', lastError: { at: 5 } } },
    drafts: {
      x: {
        text: '故事',
        plan: 'bad',
        order: { bad: true },
        lines: 4,
        checklist: 'bad',
        targetIds: 8,
      },
    },
  });
  assert.equal(result.records.x.lastPractised, null);
  assert.equal(result.records.x.lastError, null);
  assert.deepEqual(result.drafts.x.order, []);
  assert.deepEqual(result.drafts.x.plan, {});
});
