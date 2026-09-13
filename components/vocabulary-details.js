import { escapeHTML as e } from '../js/utils.js';

// One reference renderer for the library, word learning card and writing dialog.
export function vocabularyDetails(word, { example = true, pinyin = true, pronunciation = true } = {}) {
  const text = (value) => typeof value === 'string' && value.trim() ? e(value) : '—';
  return `<dl class="vocabulary-details">${pinyin ? `<div><dt>拼音</dt><dd>${text(word.pinyin)}</dd></div>` : ''}<div><dt>中文释义</dt><dd>${text(word.definitionChinese)}</dd></div><div><dt>近义词</dt><dd>${text(word.generatedSynonyms)}</dd></div>${example ? `<div><dt>例句</dt><dd>${text(word.exampleSentence)}</dd></div>` : ''}</dl>${pronunciation ? `<button type="button" class="btn" data-speak="${e(word.word)}" aria-label="朗读${e(word.word)}">🔊 词语</button>` : ''}`;
}
