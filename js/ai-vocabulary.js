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
