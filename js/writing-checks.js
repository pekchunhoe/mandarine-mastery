import { normalize, unique } from './utils.js';
// Shared composition convention: Chinese characters, letters and numerals count;
// whitespace and ordinary punctuation do not.
export const countCompositionCharacters = (text) => [...String(text ?? '').matchAll(/[\p{L}\p{N}]/gu)].length;
export function checkWriting(text, words = [], plan = {}) {
  const count = countCompositionCharacters(text);
  const paragraphs = text
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const used = unique(words).filter((w) => text.includes(w));
  const connectors = [
    '首先',
    '接着',
    '然后',
    '后来',
    '突然',
    '于是',
    '因此',
    '最后',
    '终于',
    '虽然',
    '但是',
    '因为',
    '所以',
    '不但',
    '而且',
  ];
  const repeated = connectors
    .map((word) => ({ word, count: text.split(word).length - 1 }))
    .filter((x) => x.count >= 3);
  const long = paragraphs
    .map((p, i) => ({
      paragraph: i + 1,
      long: p.split(/[。！？!?]/).some((s) => normalize(s).length > 55),
    }))
    .filter((x) => x.long);
  const repeatedSentences = unique(
    text
      .split(/[。！？!?\n]/)
      .map(normalize)
      .filter((s) => s.length >= 6),
  ).filter((s) => normalize(text).split(s).length - 1 > 1);
  const messages = [
    `你写了${count}个汉字，分成${paragraphs.length}段，用了${used.length}个建议词语。`,
  ];
  if (count && !/[。！？!?]/.test(text)) messages.push('记得在句子结束时加上句号、问号或感叹号。');
  for (const r of repeated)
    messages.push(`“${r.word}”出现了${r.count}次，读一读，看看有没有更合适的连接方式。`);
  for (const p of long) messages.push(`第${p.paragraph}段有超过55字的句子，可以看看哪里适合分句。`);
  if (repeatedSentences.length) messages.push('有一句或一段短语重复出现，请检查是否需要保留。');
  if (count > 120 && paragraphs.length === 1) messages.push('文章只有一段。可以按事情的发展分段。');
  return {
    count,
    paragraphs: paragraphs.length,
    used,
    repeated,
    long,
    messages,
    planCount: Object.values(plan).filter((v) => typeof v === 'string' && v.trim()).length,
  };
}
export function productionEligible(text, word, min = 8) {
  return (
    text.includes(word) &&
    normalize(text).length >= Math.max(min, word.length + 5) &&
    /[。！？!?]/.test(text) &&
    !/^((我今天|我|老师).{0,8}(学习|教|知道))/.test(text)
  );
}
// Future service boundary: keep remote analysis separate from objective local checks.
export async function analyzeWriting(text, words, plan, service = null) {
  return {
    local: checkWriting(text, words, plan),
    languageReview: service ? await service.analyze({ text, words, plan }) : null,
  };
}
