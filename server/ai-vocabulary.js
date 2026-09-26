import {
  actions,
  normalizeResult,
  supplementalVocabularySchema,
  TeacherError,
} from './ai-contract.js';
import { TUTOR_ACTION as A } from '../js/tutor-actions.js';

const key = (text) => text.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '');
const chinese = (text) => /\p{Script=Han}/u.test(text);
const trustedWord = ({
  id,
  word,
  pinyin,
  definitionChinese,
  generatedSynonyms,
  synonyms,
  exampleSentence,
}) => ({ id, word, pinyin, definitionChinese, generatedSynonyms, synonyms, exampleSentence });

// Library selections stay strict. A bad supplement can be removed independently.
export function resolveVocabularyResult(raw, records, store) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new TeacherError('AI_INVALID_RESPONSE', 502);
  const { supplementalVocabulary = [], ...rest } = raw;
  if (!Array.isArray(supplementalVocabulary) || supplementalVocabulary.length > 8)
    throw new TeacherError('AI_INVALID_RESPONSE', 502);
  const data = normalizeResult(
    { ...rest, supplementalVocabulary: [] },
    actions[A.VOCABULARY_HELP].schema,
  );
  const allowed = new Map(records.map((word) => [word.id, word]));
  const library = store.getAllWords?.() || records;
  const byWord = new Map(library.map((word) => [key(word.word), word]));
  let cacheable = true;
  const selected = data.recommendations.flatMap((item) => {
    const record = allowed.get(item.vocabularyId);
    if (!record) {
      cacheable = false;
      return [];
    }
    return [{ ...item, source: 'library', vocabulary: trustedWord(record) }];
  });
  const generated = [];
  for (const rawItem of supplementalVocabulary) {
    try {
      const item = normalizeResult(rawItem, supplementalVocabularySchema);
      if (
        !chinese(item.word) ||
        !/^[\p{Script=Han}·]{1,16}$/u.test(item.word) ||
        !chinese(item.definitionChinese) ||
        !chinese(item.reason) ||
        !chinese(item.exampleSentence) ||
        !key(item.exampleSentence).includes(key(item.word)) ||
        !/\p{Script=Latin}/u.test(item.pinyin) ||
        !/^[\p{Script=Latin}\p{M}\s'’:\d-]+$/u.test(item.pinyin)
      )
        throw new TeacherError('AI_INVALID_RESPONSE', 502);
      const record = byWord.get(key(item.word));
      if (record)
        selected.push({
          source: 'library',
          vocabularyId: record.id,
          vocabulary: trustedWord(record),
          reason: item.reason,
          exampleUsage: item.exampleSentence,
        });
      else
        generated.push({
          source: 'ai',
          vocabulary: {
            word: item.word,
            pinyin: item.pinyin,
            definitionChinese: item.definitionChinese,
            exampleSentence: item.exampleSentence,
          },
          reason: item.reason,
          exampleUsage: item.exampleSentence,
        });
    } catch {
      cacheable = false;
    }
  }
  const seen = new Set();
  const accepted = [];
  // Authoritative synonyms also suppress redundant near-identical choices.
  const aliases = (word) =>
    [
      word.word,
      ...(word.synonyms || []),
      ...(word.generatedSynonyms || '').split(/[、,，;；|/\s]+/u),
    ]
      .filter(Boolean)
      .map(key);
  for (const item of [...selected, ...generated]) {
    const expression = key(item.vocabulary.word);
    if (
      seen.has(expression) ||
      aliases(item.vocabulary).some((alias) =>
        accepted.some((entry) => key(entry.vocabulary.word) === alias),
      )
    )
      continue;
    accepted.push(item);
    aliases(item.vocabulary).forEach((alias) => seen.add(alias));
    if (accepted.length === 8) break;
  }
  return { data: { recommendations: accepted, studentTask: data.studentTask }, cacheable };
}
