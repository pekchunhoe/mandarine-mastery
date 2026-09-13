// Presentation-only helpers: source essay records are never changed.
export const splitEssayParagraphs = (content) => String(content ?? '')
  .replace(/\r\n?/g, '\n')
  // The workbook uses line breaks as its paragraph structure.  A blank line is
  // the usual form, but a single line break is also a valid paragraph boundary.
  .split(/\n+/)
  .map((text) => text.trim())
  .filter(Boolean);

const normalizeReferenceText = (text) => String(text ?? '')
  .replace(/\s+/g, '')
  .trim();

// Resolves a hint's source paragraph from the imported EssayContents text.
// `paragraphIndex` is the stable reference produced by the training model;
// `referenceSentence` keeps older or incomplete hint records compatible.
export function resolveReferenceParagraph(content, { paragraphIndex, referenceSentence } = {}) {
  const paragraphs = splitEssayParagraphs(content);
  const reference = normalizeReferenceText(referenceSentence);
  const indexed = Number.isInteger(paragraphIndex) ? paragraphs[paragraphIndex] : '';

  if (indexed && (!reference || normalizeReferenceText(indexed).includes(reference))) return indexed;
  if (reference) {
    const matched = paragraphs.find((paragraph) => normalizeReferenceText(paragraph).includes(reference));
    if (matched) return matched;
  }
  return indexed || String(referenceSentence ?? '').trim();
}

const sentenceEndings = new Set(['。', '！', '？', '；', '!', '?', '…']);
const closingQuotes = new Set(['”', '’', '」', '』', '）', '】']);

export function splitChineseSentences(text) {
  const source = String(text ?? '').trim();
  const sentences = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (!sentenceEndings.has(source[index])) continue;
    let end = index + 1;
    // Keep punctuation runs (including …… and !?) and closing quotes together.
    while (end < source.length && sentenceEndings.has(source[end])) end += 1;
    while (end < source.length && closingQuotes.has(source[end])) end += 1;
    const sentence = source.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
    index = end - 1;
  }
  const finalFragment = source.slice(start).trim();
  if (finalFragment) sentences.push(finalFragment);
  return sentences;
}

export function deriveEssaySentences(content) {
  return splitEssayParagraphs(content).flatMap((paragraph, paragraphIndex) =>
    splitChineseSentences(paragraph).map((text, sentenceIndex) => ({ paragraphIndex, sentenceIndex, text })),
  );
}
