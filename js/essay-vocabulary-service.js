import { vocabularyService } from './vocabulary-service.js';

// This service indexes and ranks records already loaded by vocabularyService. It
// never owns vocabulary content: essay topics only provide semantic metadata.
const cache = new Map();
const functionKeywords = {
  '时间': ['时间', '早晨', '下午', '今天'],
  '地点': ['地点', '学校', '公园', '家里', '自然'],
  '人物': ['人物', '老师', '同学', '朋友', '家人'],
  '动作': ['动作', '帮助', '参加', '完成', '准备'],
  '心情': ['心情', '快乐', '紧张', '兴奋', '感动'],
  '起因': ['原因', '发现', '困难', '问题'],
  '经过': ['经过', '努力', '尝试', '合作', '沟通'],
  '转折': ['突然', '意外', '困难', '但是'],
  '结果': ['结果', '完成', '成功', '获得', '解决'],
  '感受': ['感受', '快乐', '感谢', '收获', '成长'],
  '连接': ['然后', '最后', '因为', '所以'],
};
const essayUsefulCategories = new Set(['动作', '心情', '品德', '交流', '学习', '自然', '地点']);

const gradeScore = (wordGrade, studentGrade) => {
  const distance = Math.abs(Number(wordGrade) - studentGrade);
  if (studentGrade === 1) return wordGrade === 1 ? 26 : wordGrade === 2 ? 6 : -28;
  const lower = studentGrade <= 2 ? 1 : studentGrade - 1;
  const upper = studentGrade <= 2 ? studentGrade : Math.min(6, studentGrade + 1);
  if (wordGrade >= lower && wordGrade <= upper) return 28 - distance * 5;
  return Math.max(-18, 8 - distance * 8);
};
const searchable = (word) =>
  [word.word, word.category, ...word.tags, ...word.essayTopics, ...word.collocations, word.exampleSentence]
    .join(' ')
    .toLowerCase();
const countMatches = (text, terms, value) =>
  terms.reduce((score, term) => score + (text.includes(String(term).toLowerCase()) ? value : 0), 0);
const usable = (word) => {
  const length = [...word.word].length;
  return /^[\p{Script=Han}]+$/u.test(word.word) && length >= 2 && length <= 6 && !!word.exampleSentence;
};
const uniqueWords = (words) => {
  const seen = new Set();
  return words.filter((word) => !seen.has(word.word) && seen.add(word.word));
};

export function recommendEssayVocabulary(topic, grade, options = {}) {
  if (!topic) return [];
  const selectedGrade = Math.max(1, Math.min(6, Number(grade) || 3));
  const functionFilter = options.function === '全部' ? '' : options.function || '';
  const key = `${topic.id}|${selectedGrade}|${functionFilter}`;
  let ranked = cache.get(key);
  if (!ranked) {
    const terms = [...topic.keywords, topic.category];
    const functionTerms = functionFilter ? functionKeywords[functionFilter] || [] : [];
    ranked = uniqueWords(vocabularyService
      .getAllWords()
      .filter(usable)
      .map((word) => {
        const text = searchable(word);
        let score = gradeScore(word.grade, selectedGrade);
        score += countMatches(text, terms, 22);
        score += countMatches(text, topic.writingFunctions.flatMap((f) => functionKeywords[f] || []), 4);
        score += countMatches(text, functionTerms, 16);
        if (word.essayTopics.includes(topic.title)) score += 65;
        if (word.category && topic.keywords.includes(word.category)) score += 20;
        if ([...word.word].length === 2) score += 15;
        else if ([...word.word].length === 4) score += selectedGrade >= 4 ? 5 : -8;
        if (word.difficulty != null) score += Math.max(-8, 8 - Math.abs(word.difficulty - Math.ceil(selectedGrade / 2)) * 4);
        if (word.tags.length || word.essayTopics.length || essayUsefulCategories.has(word.category)) score += 9;
        else score -= 8;
        return { word, score };
      })
      .sort((a, b) => b.score - a.score || a.word.word.localeCompare(b.word.word, 'zh-Hans') || a.word.id.localeCompare(b.word.id))
      .map(({ word }) => word)).slice(0, 40);
    // Layered fallback: suitable nearby-grade words keep every prompt useful
    // even when the central library has not been tagged for that exact topic.
    if (ranked.length < 24)
      ranked = uniqueWords(vocabularyService
        .getAllWords()
        .filter(usable)
        .sort((a, b) => gradeScore(b.grade, selectedGrade) - gradeScore(a.grade, selectedGrade) || ([...b.word].length === 2) - ([...a.word].length === 2))
        ).slice(0, 32);
    cache.set(key, ranked);
  }
  const recent = new Set(options.recentIds || []);
  const unseen = ranked.filter((word) => !recent.has(word.id));
  return (unseen.length >= 8 ? unseen : ranked).slice(0, options.limit || 32);
}

export function clearEssayVocabularyCache() {
  cache.clear();
}
