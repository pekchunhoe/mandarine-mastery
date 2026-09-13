import { countCompositionCharacters } from './writing-checks.js';
import { splitChineseSentences, splitEssayParagraphs } from './essay-sentence-service.js';

export { splitEssayParagraphs } from './essay-sentence-service.js';

const endings = /[。！？!?]+$/u;
const reflective = /(?:感到|觉得|明白|懂得|希望|决定|学会|收获|感谢|难忘|喜欢)/u;
const eventWords = /(?:有一次|一天|当|后来|突然|开始|发现|发生|比赛|看到)/u;
const resultWords = /(?:最后|终于|结果|后来|完成|解决|成功)/u;

export const splitEssaySentences = splitChineseSentences;

export function paragraphLabel(paragraph, index, total) {
  if (index === 0) return '开头';
  if (index === total - 1) return reflective.test(paragraph) ? '感受与结尾' : '结尾';
  if (reflective.test(paragraph)) return '感受';
  if (resultWords.test(paragraph)) return '结果';
  if (eventWords.test(paragraph)) return '事情开始';
  return `第${index + 1}段`;
}

const shorten = (sentence, limit = 18) => {
  const clean = String(sentence ?? '').replace(endings, '').trim();
  if (countCompositionCharacters(clean) <= limit) return clean;
  let count = 0;
  let result = '';
  for (const character of clean) {
    result += character;
    if (/[\p{L}\p{N}]/u.test(character)) count += 1;
    if (count >= limit) break;
  }
  return result.replace(/[，、；：]$/u, '') + '……';
};

export function sentenceCue(sentence) {
  const text = String(sentence ?? '').replace(endings, '').trim();
  if (/^有一次/u.test(text)) return '有一次，__________。';
  if (/^有一天/u.test(text)) return '有一天，__________。';
  if (/^当/u.test(text)) return '当__________的时候，__________。';
  if (text.includes('从这件事')) return '从这件事中，我明白了__________。';
  if (text.includes('我觉得')) return '我觉得__________。';
  if (text.includes('我希望')) return '我希望以后__________。';
  if (text.includes('后来')) return '后来，__________。';
  const comma = text.indexOf('，');
  if (comma > 1 && comma < text.length - 3) return `${shorten(text.slice(0, comma), 8)}，__________。`;
  return '__________，__________。';
}

export function deriveParagraphTraining(paragraph, index, total, topic = {}) {
  const sentences = splitEssaySentences(paragraph);
  const representativeSentence = sentences[0] || paragraph;
  const keyPoints = [...new Set(sentences.slice(0, 3).map((sentence) => shorten(sentence)).filter(Boolean))].slice(0, 3);
  const label = paragraphLabel(paragraph, index, total);
  const role = label === '开头'
    ? '介绍人物、时间、地点或背景。'
    : label.includes('结尾')
      ? '写结果、感受或想法，让文章完整。'
      : label === '感受'
        ? '说说你的感受、收获或希望。'
        : '按自己的经历，把事情写清楚。';
  return {
    order: index + 1,
    paragraphIndex: index,
    text: paragraph,
    label,
    role,
    keyPoints,
    representativeSentence,
    sentenceCue: sentenceCue(representativeSentence),
    keywords: (topic.suggestedKeywords || []).slice(0, 6),
  };
}

export function deriveEssayTraining(content, topic = {}) {
  const paragraphs = splitEssayParagraphs(content.content);
  return {
    essayId: content.essayId,
    contentId: content.contentId,
    paragraphCount: paragraphs.length,
    paragraphs: paragraphs.map((paragraph, index) => deriveParagraphTraining(paragraph, index, paragraphs.length, topic)),
    writingQuestions: [
      `你想围绕《${topic.title || content.contentTitle || '这个题目'}》写谁或什么？`,
      '事情是在什么时候、哪里发生的？',
      '事情怎样开始，又怎样发展？',
      '最后结果怎样？你有什么感受？',
    ],
    sentenceStarters: ['有一天，……', '有一次，……', '当我……的时候，……', '我发现……', '后来，……', '最后，……', '从这件事中，我明白……', '我觉得……', '我希望以后……'],
  };
}

export const writingLengthGuidance = (count) => {
  if (count < 150) return '还太短了，试着补充事情的经过和感受。';
  if (count < 200) return '可以再丰富一点；200–400字最合适。';
  if (count <= 400) return '字数在推荐范围内。';
  if (count <= 600) return '内容很完整；注意有没有可以分段或精简的地方。';
  return '内容偏长；可以检查是否有重复的句子。';
};
