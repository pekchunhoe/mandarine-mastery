// Shared by the sentence activity, browser cache guard and server validation.
// Presence is literal; meaning and grammar remain separate teacher checks.
export const MAX_KEYWORD_LENGTH = 80;
export const keywordReminder = (keyword) =>
  `你的句子还没有用到“${keyword}”，试试看把这个词语加入句子里！`;

export function validKeywordSentences(text, keyword) {
  if (typeof text !== 'string' || !text.trim() || typeof keyword !== 'string' || !keyword) return false;
  // Protect punctuation that is part of the exact target itself.
  let marker = '\u0000';
  while (text.includes(marker)) marker += '\u0000';
  const sentences = text.split(keyword).join(marker).split(/[。！？!?\r\n]+|(?<!\d)\.(?!\d)/u)
    .map((part) => part.replace(/[\p{P}\p{Z}\s]/gu, '')).filter(Boolean);
  return sentences.length > 0 && sentences.every((part) => part.includes(marker));
}

export function validSentenceKeywordResult(action, data, keyword) {
  if (!keyword) return true; // Older clients without a target retain their contract.
  const examples = [];
  if (action === 'sentence_hint') examples.push(...(data.usefulPatterns || []));
  if (action === 'sentence_check' && data.suggestedRevision) examples.push(data.suggestedRevision);
  if (action === 'sentence_expand') examples.push(...(data.levels || []).map((item) => item.example));
  if (action === 'sentence_vivid') examples.push(data.example, data.tryYourself);
  if (action === 'vocabulary_help') {
    examples.push(...(data.recommendations || []).map((item) => item.exampleUsage));
    examples.push(...(data.supplementalVocabulary || []).map((item) => item.exampleSentence));
    examples.push(...(data.recommendations || [])
      .filter((item) => item.source === 'ai').map((item) => item.vocabulary?.exampleSentence));
  }
  // Explanations need not repeat the target. Catch explicitly labelled examples
  // there too, without treating quoted student errors as model sentences.
  const visit = (value, key = '') => {
    if (key === 'original' || key === 'vocabulary') return;
    if (typeof value === 'string') {
      for (const match of value.matchAll(/(?:例如|比如|示范|改为|改成|可以写成|可以这样写)[：:，,\s]*[“「"]([^”」"]+)[”」"]/gu))
        examples.push(match[1]);
      for (const match of value.matchAll(/[“「"]([^”」"]*[。！？!?][^”」"]*)[”」"]/gu))
        if (!data.original?.includes(match[1])) examples.push(match[1]);
      for (const match of value.matchAll(/(?:例如|比如|示范|改为|改成|可以写成|可以这样写)[：:]\s*([^“「"\r\n]+?[。！？!?])/gu))
        examples.push(match[1]);
    } else if (Array.isArray(value)) value.forEach((item) => visit(item));
    else if (value && typeof value === 'object')
      Object.entries(value).forEach(([name, child]) => visit(child, name));
  };
  visit(data);
  return examples.every((text) => validKeywordSentences(text, keyword));
}
