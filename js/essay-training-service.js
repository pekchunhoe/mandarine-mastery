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
  const narrative = isNarrativeTopic(topic);
  const label = narrative ? paragraphLabel(paragraph, index, total) : `第${index + 1}段`;
  const role = !narrative ? `围绕题目写清楚这一部分，注意${topic.essayType || '所选文体'}的表达和格式。` : label === '开头'
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

export function isNarrativeTopic(topic = {}) {
  return (!topic.essayType || /^(命题作文|记叙文|想象作文|看图作文|游记)$/.test(topic.essayType)) && !/日记|演讲|书信|一封信|写信/.test(topic.title || '');
}

export function deriveEssayTraining(content, topic = {}) {
  const paragraphs = splitEssayParagraphs(content.content);
  const narrative = isNarrativeTopic(topic);
  return {
    essayId: content.essayId,
    contentId: content.contentId,
    paragraphCount: paragraphs.length,
    paragraphs: paragraphs.map((paragraph, index) => deriveParagraphTraining(paragraph, index, paragraphs.length, topic)),
    scaffoldSource: '本地学习支架（根据文体与范文段落生成）',
    writingQuestions: narrative ? [
      `你想围绕《${topic.title || content.contentTitle || '这个题目'}》写谁或什么？`,
      '事情是在什么时候、哪里发生的？',
      '事情怎样开始，又怎样发展？',
      '最后结果怎样？你有什么感受？',
    ] : [`《${topic.title || content.contentTitle}》想表达什么？`, `这篇${topic.essayType || '文章'}写给谁看？要注意什么格式？`, '每一部分要写什么内容或细节？', '怎样安排内容，读者才容易明白？'],
    sentenceStarters: narrative ? ['有一天，……', '有一次，……', '当我……的时候，……', '我发现……', '后来，……', '最后，……', '从这件事中，我明白……', '我觉得……', '我希望以后……'] : ['我想介绍……', '例如，……', '我注意到……', '我认为……'],
    checklist: narrative ? ['我有写清楚人物或事情。', '我有分段。', '事情有开始、经过和结果。', '我用了完整句子。', '我写了自己的感受。', '我检查了错别字。', '我的结尾完整。'] : ['内容围绕题目。', '段落安排清楚。', `我注意了${topic.essayType || '文章'}的格式。`, '我用了完整句子。', '细节和说明清楚。', '我检查了错别字。', '文章表达完整。'],
  };
}

export const writingLengthGuidance = (count, topic) => {
  if (topic) {
    if (topic.minWords != null && count < topic.minWords) return `题目建议至少 ${topic.minWords} 字。`;
    if (topic.maxWords != null && count > topic.maxWords) return `题目建议不超过 ${topic.maxWords} 字。`;
    return topic.gradeMin <= 2 ? '先用完整句子写清楚自己的内容。' : `按${topic.essayType || '文章'}的特点安排段落，补充清楚、相关的细节。`;
  }
  if (count < 150) return '还太短了，试着补充事情的经过和感受。';
  if (count < 200) return '可以再丰富一点；200–400字最合适。';
  if (count <= 400) return '字数在推荐范围内。';
  if (count <= 600) return '内容很完整；注意有没有可以分段或精简的地方。';
  return '内容偏长；可以检查是否有重复的句子。';
};
