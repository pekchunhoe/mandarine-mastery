import { TUTOR_ACTION as A, TUTOR_ACTIVITY as B } from '../js/tutor-actions.js';

export const runningScenario = '运动会参加长跑比赛，跑到一半觉得很累，想放弃，后来听到同学们为我加油，我终于跑到了终点。';
export const runningSentence = '我坚持跑到了终点。';
export const scenarioRequest = (action, overrides = {}) => ({ action, activity: B.SENTENCE, context: {
  topic: '坚持', keywordMode: 'custom', situation: runningScenario,
  studentSentence: runningSentence, studentYearLevel: 3,
  ...(action === A.VOCABULARY_HELP ? { availableVocabularyIds: [] } : {}), ...overrides,
} });

export function runningResult(action, context = scenarioRequest(action).context, resolved = false) {
  const first = '虽然我跑到一半已经很累，但听到同学们的加油声后，我还是坚持跑到了终点。';
  const second = '听到同学们的加油声后，我重新鼓起勇气，坚持跑到了终点。';
  const studentTask = '选一个相关细节，自己修改后再读一读。';
  const supplementalVocabulary = [
    { word: '气喘吁吁', pinyin: 'qì chuǎn xū xū', definitionChinese: '呼吸急促的样子。', reason: '可用来描写长跑途中很累的样子；确认符合你的感受后再用。', exampleSentence: '如果当时已经气喘吁吁，可以写听到加油声后，我仍坚持跑到了终点。' },
    { word: '咬紧牙关', pinyin: 'yǎo jǐn yá guān', definitionChinese: '形容努力忍受困难。', reason: '可用来描写听到加油后努力继续跑；按真实动作选择。', exampleSentence: '如果当时咬紧牙关继续跑，可以写我在同学们的加油声中，坚持跑到了终点。' },
    { word: '鼓起勇气', pinyin: 'gǔ qǐ yǒng qì', definitionChinese: '使自己有勇气面对困难。', reason: '可用来描写听到同学加油后决定继续跑的心情。', exampleSentence: '听到同学们的加油声后，我鼓起勇气，坚持跑到了终点。' },
    { word: '全力以赴', pinyin: 'quán lì yǐ fù', definitionChinese: '尽全部力量去做。', reason: '可用来描写继续向终点努力，按自己当时的情况选用。', exampleSentence: '如果当时使出了全部力量，可以写我全力以赴，在同学们的加油声中坚持跑到了终点。' },
  ];
  const data = {
    [A.SENTENCE_HINT]: {
      thinkingQuestions: ['跑到一半时，你有多累？', '听到同学加油后，你怎么想？', '你怎样继续跑到终点？'],
      usefulPatterns: [], examples: [first, second], studentTask,
    },
    [A.SENTENCE_CHECK]: {
      original: context.studentSentence, status: 'correct', issues: [],
      strengths: ['原句通顺，写出了继续跑到终点的结果。'],
      styleSuggestions: [{ text: '可以补充同学的加油声，说明为什么继续跑。', explanation: '这能把句子和长跑情境联系得更清楚，原句没有明显语法错误。' }],
      suggestedRevision: second, studentTask,
    },
    [A.SENTENCE_EXPAND]: {
      original: context.studentSentence,
      levels: [
        { level: 1, focus: '加入长跑途中很累的感受', example: '长跑比赛进行到一半时，我虽然觉得很累，还是坚持跑到了终点。' },
        { level: 2, focus: '加入听到同学加油后继续跑的原因', example: first },
      ], studentTask,
    },
    [A.SENTENCE_VIVID]: {
      original: context.studentSentence,
      techniques: [{ type: '心理描写', suggestion: '用“重新鼓起勇气”写出听到同学加油后继续跑的心情。' }],
      example: second, tryYourself: '听到____的加油声后，我____，坚持跑到了终点。', studentTask,
    },
    [A.VOCABULARY_HELP]: {
      ...(resolved ? { recommendations: supplementalVocabulary.map(({ reason, exampleSentence, ...vocabulary }) => ({
        source: 'ai', vocabulary: { ...vocabulary, exampleSentence }, reason, exampleUsage: exampleSentence,
      })) } : { recommendations: [], supplementalVocabulary }),
      examples: [second, '如果当时已经气喘吁吁，可以写听到加油声后，我仍坚持跑到了终点。'], studentTask,
    },
  }[action];
  // The same sporting event is also tested with the existing built-in 尽力.
  const result = JSON.parse(JSON.stringify(data).replaceAll('坚持', context.topic));
  if ('original' in result) result.original = context.studentSentence;
  return result;
}
