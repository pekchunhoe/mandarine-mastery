import { dayKey, normalize, unique } from './utils.js';
export const weights = {
  recognition: 2,
  context: 4,
  recall: 7,
  guided: 9,
  sentence: 14,
  paragraph: 22,
  reviewed: 25,
};
export const emptyRecord = (word) => ({
  word,
  seen: 0,
  correct: 0,
  incorrect: 0,
  recognition: 0,
  context: 0,
  recall: 0,
  guided: 0,
  sentenceSuccess: 0,
  paragraphSuccess: 0,
  reviewed: 0,
  mastery: 0,
  lastPractised: null,
  lastCorrect: null,
  due: null,
  lastError: null,
  selfRating: null,
});
// Index source relationships once; keep live records for self-assessment edits.
const progressIndexes = new WeakMap();
export const stage = (n) =>
  n >= 90 ? '🏆 已掌握' : n >= 65 ? '⭐ 会使用' : n >= 25 ? '🌿 学习中' : '🌱 初识';
export function calculateMastery(r) {
  const points =
    r.recognition * 2 +
    r.context * 4 +
    r.recall * 7 +
    r.guided * 9 +
    r.sentenceSuccess * 14 +
    r.paragraphSuccess * 22 +
    r.reviewed * 25;
  // Recognition alone can never unlock production mastery. Free writing is practice
  // evidence, not semantic validation; the final band needs explicit human review.
  const cap =
    r.reviewed && r.paragraphSuccess && r.sentenceSuccess && r.recall
      ? 100
      : r.paragraphSuccess && r.sentenceSuccess && r.recall
        ? 89
        : r.sentenceSuccess
          ? 84
          : r.guided
            ? 64
            : r.recall
              ? 59
              : r.context
                ? 44
                : 24;
  const reliability = r.correct / Math.max(1, r.correct + r.incorrect);
  return Math.round(Math.min(cap, points * (0.6 + 0.4 * reliability)));
}
export function recordAttempt(
  state,
  item,
  kind,
  correct,
  { hint = 0, answer = '', now = new Date(), error = '', session = '' } = {},
) {
  progressIndexes.delete(state.records);
  const r = (state.records[item.id] ||= emptyRecord(item.word));
  const date = dayKey(now),
    signature = `${date}|${item.word}|${kind}|${normalize(answer) || session}`;
  // A submitted answer earns credit once per day across duplicate source characters.
  if (state.credits[signature]) return { record: r, xp: 0, duplicate: true };
  state.credits[signature] = date;
  r.seen++;
  r.lastPractised = now.toISOString();
  if (correct) {
    r.correct++;
    r.lastCorrect = now.toISOString();
    const field =
      kind === 'sentence' ? 'sentenceSuccess' : kind === 'paragraph' ? 'paragraphSuccess' : kind;
    r[field] = (r[field] || 0) + 1;
  } else {
    r.incorrect++;
    r.lastError = {
      at: now.toISOString(),
      kind,
      message: error || '这次还需要练习',
      answer: String(answer).slice(0, 200),
    };
  }
  r.mastery = calculateMastery(r);
  const interval = !correct
    ? 0
    : r.mastery >= 90
      ? 14
      : r.mastery >= 65
        ? 7
        : r.mastery >= 40
          ? 3
          : 1;
  const due = new Date(now);
  due.setDate(due.getDate() + interval);
  r.due = due.toISOString();
  const xp = correct ? Math.max(1, (weights[kind] || 2) - Math.min(hint, 3)) : 0;
  state.xp += xp;
  if (!state.days.includes(date)) state.days.push(date);
  state.recent = unique([item.id, ...state.recent]).slice(0, 40);
  state.history.push({ id: item.id, word: item.word, kind, correct, at: now.toISOString(), xp });
  state.history = state.history.slice(-2000);
  for (const [k, v] of Object.entries(state.credits))
    if (v < dayKey(new Date(now.getTime() - 3 * 86400000))) delete state.credits[k];
  return { record: r, xp };
}
export function aggregate(state, word) {
  let index = progressIndexes.get(state.records);
  if (!index) {
    index = new Map();
    for (const record of Object.values(state.records)) {
      if (!index.has(record.word)) index.set(record.word, []);
      index.get(record.word).push(record);
    }
    progressIndexes.set(state.records, index);
  }
  const records = index.get(word) || [];
  const total = emptyRecord(word);
  for (const r of records)
    for (const k of [
      'seen',
      'correct',
      'incorrect',
      'recognition',
      'context',
      'recall',
      'guided',
      'sentenceSuccess',
      'paragraphSuccess',
      'reviewed',
    ])
      total[k] += r[k] || 0;
  total.mastery = calculateMastery(total);
  total.lastPractised =
    records
      .map((r) => r.lastPractised)
      .filter(Boolean)
      .sort()
      .at(-1) || null;
  total.lastCorrect =
    records
      .map((r) => r.lastCorrect)
      .filter(Boolean)
      .sort()
      .at(-1) || null;
  total.due =
    records
      .filter((r) => r.lastPractised)
      .sort((a, b) => b.lastPractised.localeCompare(a.lastPractised))[0]?.due || null;
  total.lastError =
    records
      .map((r) => r.lastError)
      .filter(Boolean)
      .sort((a, b) => b.at.localeCompare(a.at))[0] || null;
  return total;
}
export function isWeak(r) {
  return r.incorrect > 0 && (r.correct < r.incorrect * 3 || r.mastery < 45);
}
export function reviewQueue(items, state, limit = 10, now = new Date()) {
  const scores = unique(items, (x) => x.word)
    .map((item) => {
      const r = aggregate(state, item.word),
        age = r.lastPractised ? (now - new Date(r.lastPractised)) / 86400000 : 30;
      const due = r.due && new Date(r.due) <= now;
      const recentError =
        r.lastError &&
        (!r.lastCorrect || r.lastError.at > r.lastCorrect) &&
        now - new Date(r.lastError.at) < 3 * 86400000;
      const justPractised =
        !recentError && r.lastCorrect && now - new Date(r.lastCorrect) < 3600000;
      return {
        item,
        score:
          (recentError ? 80 : 0) +
          (isWeak(r) ? 40 : 0) +
          (due ? 35 : 0) +
          Math.min(30, age) +
          (r.recognition && !r.sentenceSuccess ? 15 : 0) -
          (justPractised ? 60 : 0),
        r,
      };
    })
    .sort((a, b) => b.score - a.score);
  const out = [],
    easy = scores.filter((x) => x.r.mastery >= 45),
    hard = scores.filter((x) => x.r.mastery < 45);
  while (out.length < limit && (hard.length || easy.length)) {
    const list = out.length % 4 === 3 && easy.length ? easy : hard.length ? hard : easy;
    out.push(list.shift().item);
  }
  return out;
}
export function streak(days, now = new Date()) {
  const set = new Set(days);
  const cursor = new Date(now);
  if (!set.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (set.has(dayKey(cursor))) {
    count++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}
