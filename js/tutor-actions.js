// Public contract only. Teaching instructions and output schemas stay server-side.
import { countCompositionCharacters } from './writing-checks.js';

export const TUTOR_ACTION = Object.freeze({
  SENTENCE_HINT: 'sentence_hint',
  SENTENCE_CHECK: 'sentence_check',
  SENTENCE_EXPAND: 'sentence_expand',
  SENTENCE_VIVID: 'sentence_vivid',
  VOCABULARY_HELP: 'vocabulary_help',
  ESSAY_NEXT_STEP: 'essay_next_step',
  PARAGRAPH_REVIEW: 'paragraph_review',
  ESSAY_REVIEW: 'essay_review',
});
export const TUTOR_ACTIVITY = Object.freeze({ SENTENCE: 'sentenceBuilder', ESSAY: 'guidedEssay' });
const A = TUTOR_ACTION,
  B = TUTOR_ACTIVITY;
export const tutorActions = Object.freeze({
  [A.SENTENCE_HINT]: {
    label: '💡 给我提示',
    activities: [B.SENTENCE, B.ESSAY],
    fields: [
      'topic',
      'situation',
      'studentSentence',
      'essayTitle',
      'keyPoints',
      'currentParagraph',
      'currentStep',
    ],
  },
  [A.SENTENCE_CHECK]: {
    label: '🔍 检查句子',
    activities: [B.SENTENCE],
    fields: ['topic', 'situation', 'studentSentence'],
    requiredText: 'studentSentence',
  },
  [A.SENTENCE_EXPAND]: {
    label: '🌱 帮我扩写',
    activities: [B.SENTENCE],
    fields: ['topic', 'situation', 'studentSentence'],
    requiredText: 'studentSentence',
  },
  [A.SENTENCE_VIVID]: {
    label: '✨ 写得更生动',
    activities: [B.SENTENCE],
    fields: ['topic', 'situation', 'studentSentence'],
    requiredText: 'studentSentence',
  },
  [A.VOCABULARY_HELP]: {
    label: '📚 推荐好词',
    activities: [B.SENTENCE, B.ESSAY],
    fields: [
      'topic',
      'situation',
      'studentSentence',
      'essayTitle',
      'keyPoints',
      'currentParagraph',
      'availableVocabularyIds',
    ],
  },
  [A.ESSAY_NEXT_STEP]: {
    label: '➡️ 下一步怎么写？',
    activities: [B.ESSAY],
    fields: ['essayTitle', 'keyPoints', 'previousParagraphs', 'currentParagraph', 'currentStep'],
  },
  [A.PARAGRAPH_REVIEW]: {
    label: '🔍 检查这一段',
    activities: [B.ESSAY],
    fields: ['essayTitle', 'keyPoints', 'previousParagraphs', 'currentParagraph', 'currentStep'],
    requiredText: 'currentParagraph',
  },
  [A.ESSAY_REVIEW]: {
    label: '🩺 作文体检',
    activities: [B.ESSAY],
    fields: ['essayTitle', 'keyPoints', 'studentEssay'],
    requiredText: 'studentEssay',
  },
});
export const activityTutorActions = Object.freeze({
  [B.SENTENCE]: [
    A.SENTENCE_HINT,
    A.SENTENCE_CHECK,
    A.SENTENCE_EXPAND,
    A.SENTENCE_VIVID,
    A.VOCABULARY_HELP,
  ],
  [B.ESSAY]: [
    A.SENTENCE_HINT,
    A.VOCABULARY_HELP,
    A.ESSAY_NEXT_STEP,
    A.PARAGRAPH_REVIEW,
    A.ESSAY_REVIEW,
  ],
});
export const MAX_BODY = 32768;
export const MAX_CONTEXT_TEXT = 8000;
export const MIN_ESSAY_CHARACTERS = 50;
export const textLimits = Object.freeze({
  topic: 160,
  situation: 240,
  essayTitle: 160,
  studentSentence: 500,
  currentParagraph: 2000,
  studentEssay: 6000,
});
export const arrayLimits = Object.freeze({
  keyPoints: [8, 240],
  previousParagraphs: [20, 2000],
  availableVocabularyIds: [16, 120],
});
export class TutorInputError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Shared validation avoids quota for trivial input, and is rerun independently on the server.
export function tutorRequest(action, activity, raw = {}) {
  const invalid = () => {
    throw new TutorInputError('INVALID_REQUEST', '内容格式有误，请重新打开 AI老师再试。');
  };
  const tooLong = () => {
    throw new TutorInputError('TEXT_TOO_LONG', '内容太长了，请缩短当前内容后再试。');
  };
  const spec = Object.hasOwn(tutorActions, action) && tutorActions[action];
  if (
    !spec ||
    !spec.activities.includes(activity) ||
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw)
  )
    invalid();
  const context = {};
  for (const field of spec.fields) {
    // Do not send sentence fields from an essay, or essay fields from a sentence.
    if (activity === B.ESSAY && ['topic', 'situation', 'studentSentence'].includes(field)) continue;
    if (
      activity === B.SENTENCE &&
      ['essayTitle', 'keyPoints', 'currentParagraph', 'currentStep'].includes(field)
    )
      continue;
    const value = raw[field];
    if (value === undefined) continue;
    if (field in textLimits) {
      if (typeof value !== 'string') invalid();
      if (value.length > textLimits[field]) tooLong();
      context[field] = value;
    } else if (field in arrayLimits) {
      const [count, length] = arrayLimits[field];
      if (
        !Array.isArray(value) ||
        value.length > count ||
        value.some((item) => typeof item !== 'string' || item.length > length)
      )
        invalid();
      context[field] = field === 'availableVocabularyIds' ? [...new Set(value)] : [...value];
    } else {
      if (!Number.isInteger(value) || value < 1 || value > 100) invalid();
      context[field] = value;
    }
  }
  const size = Object.values(context).reduce(
    (sum, value) =>
      sum +
      (Array.isArray(value) ? value.join('').length : typeof value === 'string' ? value.length : 0),
    0,
  );
  if (size > MAX_CONTEXT_TEXT) tooLong();
  if (spec.requiredText && !context[spec.requiredText]?.trim()) {
    throw new TutorInputError(
      'TEXT_REQUIRED',
      activity === B.SENTENCE
        ? '先写一句话，我才能帮你看看哦。'
        : action === A.PARAGRAPH_REVIEW
          ? '先完成这一段，再让我帮你看看。'
          : '先多写一些内容，再来做作文体检吧。',
    );
  }
  if (
    action === A.ESSAY_REVIEW &&
    countCompositionCharacters(context.studentEssay) < MIN_ESSAY_CHARACTERS
  ) {
    throw new TutorInputError(
      'ESSAY_TOO_SHORT',
      '先把事情写得更完整一些（至少 50 字），再来做作文体检吧。',
    );
  }
  return { action, activity, context };
}

export function localTutorResult(action, context) {
  if (
    action === A.SENTENCE_HINT &&
    !context.studentSentence?.trim() &&
    !context.currentParagraph?.trim()
  ) {
    return {
      thinkingQuestions: ['谁在什么地方？', '发生了什么事？', '你当时有什么感受？'],
      usefulPatterns: ['因为……所以……'],
      studentTask: '想一想当前的题目或情境，选择一个问题，先自己写一句话。',
    };
  }
  if (action === A.VOCABULARY_HELP && !context.availableVocabularyIds?.length) {
    return { recommendations: [], studentTask: '打开词语库，找一个符合情境的词，自己写一句话。' };
  }
  return null;
}

export const tutorLoading = (action) =>
  action === A.ESSAY_REVIEW
    ? 'AI老师正在看看你的作文……'
    : action === A.PARAGRAPH_REVIEW
      ? '正在分析这一段……'
      : action === A.ESSAY_NEXT_STEP
        ? 'AI老师正在看看你写到哪里了……'
        : action === A.VOCABULARY_HELP
          ? 'AI老师正在挑选合适的好词……'
          : 'AI老师正在看看你的句子……';
