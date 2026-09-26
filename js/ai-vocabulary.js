import { vocabularyService } from './vocabulary-service.js';
import { recommendEssayVocabulary } from './essay-vocabulary-service.js';

// Reuse the existing search index and essay ranking; send IDs, never browser definitions.
export function teachingVocabularyCandidates(topic, grade, writingPoint, text) {
  const terms = [
    ...new Set([...(topic.suggestedKeywords || []), ...writingPoint.split(/[、，。\s]+/u)]),
  ].filter((term) => term.length >= 2);
  const contextual = terms.flatMap((term) => vocabularyService.searchWords(term).slice(0, 3));
  const ranked = recommendEssayVocabulary(topic, grade, { limit: 32 });
  const words = [...new Map([...contextual, ...ranked].map((word) => [word.id, word])).values()];
  // Prefer words whose definitions/tags overlap concepts already present in the draft.
  const score = (word) =>
    [word.word, word.category, ...word.tags, ...word.synonyms].filter(
      (term) => term.length >= 2 && text.includes(term),
    ).length;
  return words
    .sort((a, b) => score(b) - score(a))
    .slice(0, 16)
    .map((word) => word.id);
}

export function sentenceVocabularyCandidates(situation, word, grade, text) {
  // Adapt context to the existing essay ranker; this is metadata, not a new database.
  const keywords = [situation, word, ...situation.split(/[，、。\s]+/u)].filter(Boolean);
  return teachingVocabularyCandidates(
    {
      id: `sentence:${situation}:${word}`,
      title: situation,
      category: situation,
      suggestedKeywords: keywords,
      keywords,
      writingFunctions: ['人物', '动作', '心情'],
    },
    grade,
    situation,
    text,
  );
}

// Guided Essay deliberately ranks only against text the student has written.
// It never accepts a title, writing point, hint or model-essay argument.
export function studentParagraphVocabularyCandidates(grade, studentParagraph) {
  const text = String(studentParagraph || '');
  if (!text.trim()) return [];
  const runs = text.match(/\p{Script=Han}{2,}/gu) || [];
  const terms = new Set();
  for (const run of runs)
    for (let size = 2; size <= Math.min(5, run.length); size += 1)
      for (let start = 0; start <= run.length - size; start += 1)
        terms.add(run.slice(start, start + size));
  const matches = [...terms].flatMap((term) => vocabularyService.searchWords(term).slice(0, 3));
  const gradeWords = vocabularyService.getWordsByGrade(grade);
  const score = (word) =>
    [word.word, ...(word.synonyms || []), ...(word.tags || [])].filter(
      (term) => term.length >= 2 && text.includes(term),
    ).length;
  return [
    ...new Map(
      [
        ...matches.filter((word) => score(word) > 0),
        ...gradeWords.filter((word) => score(word) > 0),
      ].map((word) => [word.id, word]),
    ).values(),
  ]
    .sort((a, b) => score(b) - score(a))
    .slice(0, 16)
    .map((word) => word.id);
}
