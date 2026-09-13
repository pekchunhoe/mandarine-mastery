import { normalizeRecord } from './vocabulary-schema.js';

export function createVocabularyService(initial = []) {
  let words = [],
    byId = new Map(),
    indexes = {},
    search = new Map();
  const indexed = ['grade', 'category', 'difficulty', 'tags', 'essayTopics', 'word'];
  function setWords(records) {
    const ids = new Set();
    words = records.map((raw) => {
      const w = normalizeRecord(raw).record;
      if (ids.has(w.id)) throw Error(`Duplicate ID: ${w.id}`);
      ids.add(w.id);
      // Compatibility fields are derived, never a second stored vocabulary dataset.
      return Object.freeze({
        ...w,
        ...Object.fromEntries(
          ['tags', 'essayTopics', 'synonyms', 'antonyms', 'collocations'].map((k) => [
            k,
            Object.freeze(w[k]),
          ]),
        ),
        example: w.exampleSentence,
        sourceCharacter: w.character,
        character: w.character || [...w.word][0],
      });
    });
    byId = new Map(words.map((w) => [w.id, w]));
    indexes = Object.fromEntries(indexed.map((k) => [k, new Map()]));
    search = new Map();
    for (const w of words) {
      for (const f of indexed)
        for (const v of Array.isArray(w[f]) ? w[f] : [w[f]]) {
          if (v == null || v === '') continue;
          const k = String(v);
          if (!indexes[f].has(k)) indexes[f].set(k, []);
          indexes[f].get(k).push(w);
        }
      const metadata = fold(
          [
            w.word,
            w.pinyin,
            w.meaningEnglish,
            w.meaningMalay,
            w.category,
            ...w.tags,
            w.character,
            w.example,
          ].join(' '),
        );
      const synonym = fold(w.generatedSynonyms);
      search.set(w.id, {
        word: fold(w.word),
        synonym,
        synonyms: synonym.split(/[\s、,，;；|/]+/u).filter(Boolean),
        pinyin: fold(w.pinyin),
        definition: fold(w.definitionChinese),
        all: [metadata, synonym, fold(w.definitionChinese)].join(' '),
      });
    }
    words = Object.freeze(words);
  }
  function query(options = {}) {
    const {
      grade,
      category,
      difficulty,
      tag,
      essayTopic,
      lesson,
      word,
      query: q = '',
      pool,
    } = options;
    const filters = { grade, category, difficulty, tags: tag, essayTopics: essayTopic, word };
    const lists = Object.entries(filters)
      .filter(([, v]) => v != null && !['', 'all', 'mixed'].includes(String(v)))
      .map(([k, v]) => indexes[k].get(String(v)) || []);
    const source =
      pool || (lists.length ? lists.reduce((a, b) => (a.length < b.length ? a : b)) : words);
    const sets = lists.map((list) => new Set(list.map((w) => w.id))),
      terms = fold(q).split(/\s+/).filter(Boolean);
    const result = source.filter(
      (w) =>
        sets.every((s) => s.has(w.id)) &&
        (!lesson || lesson === 'all' || w.lesson === lesson) &&
        terms.every((t) => search.get(w.id)?.all.includes(t)),
    );
    if (!terms.length) return result;
    const phrase = terms.join(' ');
    const rank = (w) => {
      const entry = search.get(w.id);
      if (entry.word === phrase) return 0;
      if (entry.word.startsWith(phrase)) return 1;
      if (entry.word.includes(phrase)) return 2;
      if (entry.synonyms.includes(phrase)) return 3;
      if (terms.every((t) => entry.synonym.includes(t))) return 4;
      if (terms.every((t) => entry.pinyin.includes(t))) return 5;
      if (terms.every((t) => entry.definition.includes(t))) return 6;
      return 7;
    };
    return result.sort((a, b) => rank(a) - rank(b));
  }
  function random(options = {}) {
    const result = query(options),
      count = Math.max(0, Math.floor(options.count ?? 5));
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    const selected = options.uniqueBy
      ? [...new Map(result.map((w) => [w[options.uniqueBy], w])).values()]
      : result;
    return selected.slice(0, count);
  }
  setWords(initial);
  return {
    setWords,
    query,
    getAllWords: () => words,
    getWordById: (id) => byId.get(id),
    getWordsByGrade: (grade) => query({ grade }),
    getWordsByCategory: (category) => query({ category }),
    getWordsByDifficulty: (difficulty) => query({ difficulty }),
    getWordsByTag: (tag) => query({ tag }),
    getWordsByEssayTopic: (essayTopic) => query({ essayTopic }),
    searchWords: (q, options = {}) => query({ ...options, query: q }),
    getRandomWords: random,
    getWordsForActivity: (options) => query(options),
    values: (field) =>
      [...(indexes[field]?.keys() || [])].sort((a, b) => a.localeCompare(b, 'zh-Hans')),
  };
}
export const normalizeVocabularySearch = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const fold = normalizeVocabularySearch;
export const vocabularyService = createVocabularyService();
export const getAllWords = () => vocabularyService.getAllWords();
export const getWordById = (id) => vocabularyService.getWordById(id);
export const getWordsByGrade = (grade) => vocabularyService.getWordsByGrade(grade);
export const getWordsByCategory = (category) => vocabularyService.getWordsByCategory(category);
export const getWordsByDifficulty = (level) => vocabularyService.getWordsByDifficulty(level);
export const getWordsByTag = (tag) => vocabularyService.getWordsByTag(tag);
export const getWordsByEssayTopic = (topic) => vocabularyService.getWordsByEssayTopic(topic);
export const searchWords = (q, options) => vocabularyService.searchWords(q, options);
export const getRandomWords = (options) => vocabularyService.getRandomWords(options);
export const getWordsForActivity = (options) => vocabularyService.getWordsForActivity(options);
