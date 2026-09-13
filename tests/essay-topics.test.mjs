import { test } from 'node:test';
import assert from 'node:assert/strict';
import { essayTopics, essayCategories, getActiveEssayTitles, getEssayTitleById, getEssayTitlesByCategory, getEssayTitlesByType, topicMatchesCategory, topicsForGrade } from '../js/essay-title-service.js';
import { vocabularyService } from '../js/vocabulary-service.js';
import { clearEssayVocabularyCache, recommendEssayVocabulary } from '../js/essay-vocabulary-service.js';

test('essay topic library has valid, unique, grade-specific metadata', () => {
  assert.equal(essayTopics.length, 300);
  assert.equal(new Set(essayTopics.map((topic) => topic.id)).size, essayTopics.length);
  assert.equal(new Set(essayTopics.map((topic) => topic.title)).size, essayTopics.length);
  for (const topic of essayTopics) {
    assert.ok(topic.title.trim());
    assert.ok(Number.isInteger(topic.gradeMin) && topic.gradeMin >= 1 && topic.gradeMin <= 6);
    assert.ok(Number.isInteger(topic.gradeMax) && topic.gradeMax >= topic.gradeMin && topic.gradeMax <= 6);
    assert.ok(topic.category.trim());
    assert.ok(topic.keywords.length && topic.keywords.every((keyword) => keyword.trim()));
    assert.ok(topic.writingFunctions.length);
  }
  for (const grade of [1, 2, 3, 4, 5, 6]) assert.equal(topicsForGrade(grade).length, 50);
  assert.ok(topicMatchesCategory(topicsForGrade(3)[0], '全部'));
  assert.ok(essayCategories.includes('想象'));
  assert.equal(getActiveEssayTitles().length, 300);
  assert.equal(getEssayTitleById(essayTopics[0].id).title, essayTopics[0].title);
  assert.ok(getEssayTitlesByCategory('家庭').length);
  assert.ok(getEssayTitlesByType('看图作文').length);
});

test('essay recommendations are central-library, relevant, grade-aware and duplicate-free', () => {
  const records = [
    { id: 'g1-help', word: '帮助', grade: 1, tags: ['动作'], category: '动作', exampleSentence: '我主动帮助同学。' },
    { id: 'g3-prepare', word: '准备', grade: 3, tags: ['动作'], category: '动作', exampleSentence: '比赛前我们认真准备。' },
    { id: 'g3-tense', word: '紧张', grade: 3, tags: ['心情'], category: '心情', exampleSentence: '上场前我感到紧张。' },
    { id: 'g3-flower', word: '花朵', grade: 3, tags: ['自然'], category: '自然', exampleSentence: '花朵在阳光下开放。' },
    { id: 'g5-expression', word: '全神贯注', grade: 5, tags: ['学习'], category: '学习', exampleSentence: '大家全神贯注地听讲。' },
    ...Array.from({ length: 35 }, (_, index) => ({
      id: `fallback-${index}`,
      word: `甲${String.fromCodePoint(0x4e00 + index)}`,
      grade: 3,
      exampleSentence: `这是第${index + 1}个可用词语。`,
    })),
  ];
  vocabularyService.setWords(records);
  clearEssayVocabularyCache();
  const helpTopic = essayTopics.find((topic) => topic.title === '一次帮助别人的经历');
  const results = recommendEssayVocabulary(helpTopic, 3);
  assert.ok(results.length >= 24 && results.length <= 32);
  assert.equal(new Set(results.map((word) => word.id)).size, results.length);
  assert.equal(results[0].word, '帮助');
  assert.ok(results.slice(0, 8).some((word) => word.word === '帮助'));
  assert.ok(results.filter((word) => [...word.word].length === 2).length >= 20);
  const nextGroup = results.slice(8, 16);
  assert.equal(new Set([...results.slice(0, 8), ...nextGroup].map((word) => word.id)).size, 16);
  const functionResults = recommendEssayVocabulary(helpTopic, 3, { function: '动作' });
  assert.ok(functionResults.some((word) => word.word === '帮助'));
});
