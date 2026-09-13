// One browser-speech owner for every activity. Learning screens only provide text.
const RATE_KEY = 'mandarinSpeechRate';
const rates = new Set([0.75, 1, 1.25]);
let voices = [];
let utterance = null, currentText = '', speaking = false, paused = false, rate = 1, sequence = null, sequenceId = 0;
const supported = () => typeof globalThis !== 'undefined' && !!globalThis.speechSynthesis && typeof globalThis.SpeechSynthesisUtterance === 'function';
const clean = (text) => String(text ?? '').trim();
const notify = () => {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('[data-speak], [data-speak-essay]').forEach((button) => {
    const active = speaking && (button.dataset.speak === currentText || (button.dataset.speakEssay != null && !!sequence));
    button.disabled = !supported() || (button.dataset.speakEssay == null && !clean(button.dataset.speak));
    button.classList.toggle('is-speaking', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-speech-control]').forEach((button) => {
    const action = button.dataset.speechControl;
    button.disabled = !supported() || (action === 'pause' ? !speaking || paused : action === 'resume' ? !paused : !speaking && !paused);
  });
  document.querySelectorAll('[data-speech-rate]').forEach((button) => button.classList.toggle('active', Number(button.dataset.speechRate) === rate));
};
const languageOf = (voice) => String(voice?.lang || '').replace(/_/g, '-').toLowerCase();
const nameOf = (voice) => String(voice?.name || '').toLowerCase();
const mandarinName = /mandarin|putonghua|\u666e\u901a\u8bdd|\u666e\u901a\u8a71|mainland china|\bchina\b/i;
const cantoneseName = /cantonese|hong kong|\u9999\u6e2f|\u7ca4\u8bed|\u7cb5\u8a9e|\u5e7f\u4e1c\u8bdd|\u5ee3\u6771\u8a71/i;

// Chinese locale alone is not enough: zh-HK may be a Cantonese voice.
export function isCantoneseVoice(voice) {
  const lang = languageOf(voice);
  return lang.split('-').includes('hk') || lang.startsWith('yue') || cantoneseName.test(nameOf(voice));
}

export function selectMandarinVoice(availableVoices) {
  const allowed = (availableVoices || []).filter((voice) => !isCantoneseVoice(voice));
  return (
    allowed.find((voice) => languageOf(voice) === 'zh-cn') ||
    allowed.find((voice) => languageOf(voice).startsWith('zh-cn-')) ||
    allowed.find((voice) => /^cmn-(hans|cn|sg)(-|$)/i.test(languageOf(voice))) ||
    allowed.find((voice) => /^cmn(-|$)/i.test(languageOf(voice))) ||
    allowed.find((voice) => mandarinName.test(nameOf(voice)) && /^(zh|cmn)(-|$)/i.test(languageOf(voice))) ||
    // Taiwan's standard Chinese is an acceptable Mandarin-only emergency fallback.
    allowed.find((voice) => languageOf(voice) === 'zh-tw' || languageOf(voice).startsWith('zh-tw-')) ||
    null
  );
}

export const getAvailableChineseVoices = () => voices.filter((voice) => /^(zh|cmn|yue)(-|_)/i.test(voice.lang));
export const getAvailableMandarinVoices = () => voices.filter((voice) => !isCantoneseVoice(voice) && selectMandarinVoice([voice]));
export const getSpeechRate = () => rate;
export const isSpeaking = () => speaking;
export const isPaused = () => paused;
export const isSpeechSupported = () => supported();
export function refreshSpeech(root) {
  if (globalThis.speechSynthesis?.getVoices) voices = globalThis.speechSynthesis.getVoices() || [];
  enhanceSpeechUI(root?.querySelectorAll ? root : globalThis.document?.querySelector?.('dialog[open]'));
  notify();
}
function preferredVoice() { return selectMandarinVoice(voices); }
function debugVoiceSelection(voice) {
  const host = globalThis.location?.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    console.debug('Mandarin TTS voice selected:', voice ? { name: voice.name, lang: voice.lang } : 'browser default (zh-CN)');
    console.debug('Available Chinese TTS voices:', getAvailableChineseVoices().map(({ name, lang }) => ({ name, lang })));
  }
}
export function setSpeechRate(value) {
  const next = Number(value); rate = rates.has(next) ? next : 1;
  try { globalThis.localStorage?.setItem(RATE_KEY, String(rate)); } catch {}
  notify(); return rate;
}
export function stop() {
  const cancelled = sequence;
  sequence = null;
  sequenceId += 1;
  if (supported()) globalThis.speechSynthesis.cancel();
  utterance = null; currentText = ''; speaking = false; paused = false; notify();
  cancelled?.onStop?.();
}
export function pause() {
  if (!supported() || !speaking || paused) return false;
  globalThis.speechSynthesis.pause(); paused = true; notify(); return true;
}
export function resume() {
  if (!supported() || !paused) return false;
  globalThis.speechSynthesis.resume(); paused = false; speaking = true; notify(); return true;
}
export function speak(text, options = {}) {
  const content = clean(text);
  if (!content || !supported()) return false;
  refreshSpeech(); stop();
  const next = new globalThis.SpeechSynthesisUtterance(content), voice = preferredVoice();
  // Keep the requested language Mainland Mandarin even when Taiwan Mandarin is used.
  next.lang = 'zh-CN'; if (voice) next.voice = voice;
  debugVoiceSelection(voice);
  next.rate = rates.has(Number(options.rate)) ? Number(options.rate) : rate;
  utterance = next; currentText = content; speaking = true; paused = false;
  next.onstart = () => { if (utterance === next) { speaking = true; paused = false; notify(); } };
  next.onend = next.onerror = () => { if (utterance === next) { utterance = null; currentText = ''; speaking = false; paused = false; notify(); } };
  globalThis.speechSynthesis.speak(next); notify(); return true;
}
export function speakSequence(items, options = {}) {
  const sentences = (items || []).map((item) => clean(typeof item === 'string' ? item : item?.text)).filter(Boolean);
  if (!sentences.length || !supported()) return false;
  refreshSpeech(); stop();
  const session = { id: ++sequenceId, sentences, index: 0, ...options };
  sequence = session;
  const advance = () => {
    if (sequence !== session || session.id !== sequenceId) return;
    if (session.index >= session.sentences.length) {
      sequence = null; utterance = null; currentText = ''; speaking = false; paused = false; notify();
      session.onComplete?.();
      return;
    }
    const index = session.index, content = session.sentences[index];
    const next = new globalThis.SpeechSynthesisUtterance(content), voice = preferredVoice();
    next.lang = 'zh-CN'; if (voice) next.voice = voice;
    next.rate = rates.has(Number(session.rate)) ? Number(session.rate) : rate;
    utterance = next; currentText = content; speaking = true; paused = false;
    session.onSentenceStart?.(index, content);
    next.onstart = () => { if (sequence === session && utterance === next) { speaking = true; paused = false; notify(); } };
    next.onend = () => {
      if (sequence !== session || session.id !== sequenceId || utterance !== next) return;
      session.onSentenceEnd?.(index, content);
      session.index += 1;
      advance();
    };
    next.onerror = () => {
      if (sequence !== session || session.id !== sequenceId || utterance !== next) return;
      sequence = null; utterance = null; currentText = ''; speaking = false; paused = false; notify();
      session.onStop?.();
    };
    debugVoiceSelection(voice);
    globalThis.speechSynthesis.speak(next); notify();
  };
  advance();
  return true;
}
export function initSpeech() {
  try { const stored = Number(globalThis.localStorage?.getItem(RATE_KEY)); if (rates.has(stored)) rate = stored; } catch {}
  refreshSpeech(); globalThis.speechSynthesis?.addEventListener?.('voiceschanged', refreshSpeech);
}
const attr = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;' })[char]);
export function speechButton(text, label = '朗读', className = 'speech-button') {
  const content = clean(text);
  return `<button type="button" class="${className}" data-speak="${attr(content)}" aria-label="${attr(label)}" ${content ? '' : 'disabled'}>🔊 <span>${attr(label)}</span></button>`;
}
export function speechControls(text, label = '朗读范文') {
  return `<div class="speech-reader">${speechButton(text, label, 'btn speech-read-button')}<button type="button" class="btn speech-control" data-speech-control="pause" aria-label="暂停朗读">⏸ 暂停</button><button type="button" class="btn speech-control" data-speech-control="resume" aria-label="继续朗读">▶ 继续</button><button type="button" class="btn speech-control" data-speech-control="stop" aria-label="停止朗读">⏹ 停止</button><span class="speech-rate-label">语速</span>${[[0.75,'慢速'],[1,'正常'],[1.25,'快速']].map(([value,labelText]) => `<button type="button" class="speech-rate" data-speech-rate="${value}" aria-label="${labelText} ${value} 倍">${labelText}</button>`).join('')}</div>`;
}
export function essaySpeechControls(label = '朗读范文') {
  return `<div class="speech-reader"><button type="button" class="btn speech-read-button" data-speak-essay aria-label="${attr(label)}">🔊 <span>${attr(label)}</span></button><button type="button" class="btn speech-control" data-speech-control="pause" aria-label="暂停朗读">⏸ 暂停</button><button type="button" class="btn speech-control" data-speech-control="resume" aria-label="继续朗读">▶ 继续</button><button type="button" class="btn speech-control" data-speech-control="stop" aria-label="停止朗读">⏹ 停止</button><span class="speech-rate-label">语速</span>${[[0.75,'慢速'],[1,'正常'],[1.25,'快速']].map(([value,labelText]) => `<button type="button" class="speech-rate" data-speech-rate="${value}" aria-label="${labelText} ${value} 倍">${labelText}</button>`).join('')}</div>`;
}

// Existing activities render their learning text as plain HTML. This progressive
// enhancer keeps their source data untouched while making each useful passage audible.
export function enhanceSpeechUI(root = typeof document === 'undefined' ? null : document) {
  if (!root?.querySelectorAll) return;
  const compact = (element, label) => {
    if (!clean(element?.textContent) || element.parentElement?.querySelector(':scope > [data-speech-inline]')) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'speech-button'; button.dataset.speechInline = 'true';
    button.dataset.speak = clean(element.textContent); button.setAttribute('aria-label', label); button.textContent = '🔊';
    element.insertAdjacentElement('afterend', button);
  };
  root.querySelectorAll('#word-example, .sentence-sample, .example-hint p, .paragraph-learning li, .guided-think li').forEach((element) => compact(element, '朗读学习内容'));
  root.querySelectorAll('.sentence-starter').forEach((element) => compact(element, '朗读句子提示'));
  root.querySelectorAll('.model-reading, .model-essay-reference').forEach((panel) => {
    if (panel.querySelector(':scope > .speech-reader')) return;
    const sentences = [...panel.querySelectorAll('[data-essay-sentence]')];
    const text = sentences.length ? sentences.map((sentence) => clean(sentence.textContent)).join('') : [...panel.querySelectorAll('.model-paragraph, .model-essay-text')].map((paragraph) => clean(paragraph.textContent)).filter(Boolean).join('\n\n');
    if (!text) return;
    const controls = sentences.length ? essaySpeechControls('朗读范文') : speechControls(text, '朗读范文');
    const summary = panel.querySelector(':scope > summary');
    if (summary) summary.insertAdjacentHTML('afterend', controls);
    else panel.insertAdjacentHTML('afterbegin', controls);
  });
  if (!supported()) root.querySelectorAll('[data-speak], [data-speak-essay], [data-speech-control], [data-speech-rate]').forEach((button) => { button.disabled = true; button.title = '此浏览器暂不支持朗读功能'; });
}
