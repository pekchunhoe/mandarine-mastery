import { TUTOR_ACTION as A, TUTOR_ACTIVITY as B } from '../js/tutor-actions.js';
export const sentence = '小明跑得很快。';
export const paragraphs = [
  '上星期，学校举行运动会。我和同学早早来到操场，准备参加接力赛。',
  '轮到小明时，他紧紧握住接力棒，飞快地向前跑去。我们站在跑道旁为他加油。',
  '虽然我们没有拿到第一名，但是大家互相鼓励。我感到很开心，也学会了和朋友合作。',
];
export const word = {
  id: 'curated',
  word: '奋力',
  pinyin: 'fèn lì',
  definitionChinese: '充分使出力量。',
  generatedSynonyms: '努力',
  synonyms: ['努力'],
  exampleSentence: '他奋力向前跑。',
};
export function malformedResults(valid) {
  const missing = structuredClone(valid);
  delete missing.studentTask;
  return [
    ['invalid JSON', 'not JSON'],
    ['missing required field', JSON.stringify(missing)],
    ['wrong field type', JSON.stringify({ ...valid, studentTask: 42 })],
    ['empty object', '{}'],
    ['unexpected status', JSON.stringify({ ...valid, status: 'unexpected' })],
    ['truncated response', JSON.stringify(valid).slice(0, -8)],
  ];
}
export function inputFor(action) {
  const activity = [
    A.PARAGRAPH_EXPAND,
    A.PARAGRAPH_VIVID,
    A.ESSAY_NEXT_STEP,
    A.PARAGRAPH_REVIEW,
    A.ESSAY_REVIEW,
  ].includes(action)
    ? B.ESSAY
    : B.SENTENCE;
  return {
    action,
    activity,
    context:
      activity === B.SENTENCE
        ? {
            situation: '运动会',
            topic: '跑步',
            studentSentence: sentence,
            ...(action === A.VOCABULARY_HELP ? { availableVocabularyIds: [word.id] } : {}),
          }
        : {
            essayTitle: '一次难忘的经历',
            keyPoints: ['事情的经过', '自己的感受'],
            previousParagraphs: paragraphs.slice(0, 2),
            currentParagraph: paragraphs[2],
            currentStep: 3,
            studentEssay: paragraphs.join('\n\n'),
          },
  };
}
export function resultFor(action, context = {}, vocabulary = word, resolved = false) {
  const original = context.studentSentence || sentence;
  const studentTask = '选择一个建议，用自己的想法修改，再读一读。';
  const results = {
    [A.SENTENCE_HINT]: {
      thinkingQuestions: ['小明参加什么比赛？', '大家怎样为他加油？'],
      usefulPatterns: ['一边……一边……'],
      studentTask,
    },
    [A.SENTENCE_CHECK]: {
      status: 'correct',
      original,
      issues: [],
      styleSuggestions: [
        { text: '可以加入一个动作细节。', explanation: '原句通顺，这只是可选的描写方法。' },
      ],
      suggestedRevision: '',
      studentTask,
    },
    [A.SENTENCE_EXPAND]: {
      original,
      levels: [
        { level: 1, focus: '加入地点', example: '在____，小明跑得很快。' },
        { level: 2, focus: '加入动作', example: '在____，小明____，跑得很快。' },
        { level: 3, focus: '加入观察到的细节', example: '小明____，跑得很快，我看到____。' },
      ],
      studentTask,
    },
    [A.SENTENCE_VIVID]: {
      original,
      techniques: [{ type: '动作描写', suggestion: '写一写手臂和脚的动作。' }],
      example: '小明摆动双臂，飞快地向前跑去。',
      tryYourself: '小明____，____。',
      studentTask,
    },
    ...Object.fromEntries(
      [A.PARAGRAPH_EXPAND, A.PARAGRAPH_VIVID].map((action) => [
        action,
        {
          suggestions: [{ focus: '动作描写', suggestion: '补充当时的动作和反应。' }],
          example: '我紧紧握住接力棒，听到同学的加油声，____。',
          explanation: '具体的动作可以让读者想象当时的情景。',
          studentTask,
        },
      ]),
    ),
    [A.VOCABULARY_HELP]: {
      ...(!resolved ? { supplementalVocabulary: [] } : {}),
      recommendations: [
        {
          vocabularyId: vocabulary.id,
          reason: '适合描写比赛时努力向前的动作。',
          exampleUsage: '他奋力向终点跑去。',
          ...(resolved ? { vocabulary, source: 'library' } : {}),
        },
      ],
      studentTask,
    },
    [A.ESSAY_NEXT_STEP]: {
      currentProgress: '你已经写了比赛的开始和经过。',
      directions: [
        { title: '想想结果', prompt: '比赛结束后，大家做了什么？' },
        { title: '说说感受', prompt: '你从这次合作中学到了什么？' },
      ],
      studentTask,
    },
    [A.PARAGRAPH_REVIEW]: {
      strengths: ['你写出了大家互相鼓励。'],
      issues: [{ type: '内容', text: '可以说得更具体些。', suggestions: ['想想同学说了什么话。'] }],
      missingDetails: ['可以补充当时的表情。'],
      revisionFocus: '先写清楚怎样互相鼓励。',
      studentTask,
    },
    [A.ESSAY_REVIEW]: {
      summary: '事情的顺序清楚，可以再补充动作细节。',
      categories: Object.fromEntries(
        ['topicRelevance', 'structure', 'description', 'vocabulary', 'language'].map((key) => [
          key,
          {
            status: key === 'description' ? 'improve' : 'good',
            feedback: key === 'description' ? '可以再加入具体动作。' : '这里写得清楚。',
          },
        ]),
      ),
      priorityImprovements: ['比赛经过加入一个动作。', '写一写自己的感受。'],
      studentTask,
    },
  };
  return structuredClone(results[action]);
}
