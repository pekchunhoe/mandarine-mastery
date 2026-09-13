let voices = [];
function refresh() {
  voices =
    globalThis.speechSynthesis
      ?.getVoices()
      .filter((v) => /^zh([-_](CN|TW|SG|HK))?$/i.test(v.lang) || /^cmn/i.test(v.lang)) || [];
  document.querySelectorAll('[data-speak]').forEach((b) => {
    b.disabled = !voices.length;
    b.title = voices.length ? '听一听' : '这台设备暂时没有华语语音';
  });
}
export function initSpeech() {
  refresh();
  globalThis.speechSynthesis?.addEventListener('voiceschanged', refresh);
}
export function refreshSpeech() {
  refresh();
}
export function speak(text) {
  refresh();
  if (!voices.length) return;
  globalThis.speechSynthesis.cancel();
  const speech = new SpeechSynthesisUtterance(text);
  speech.voice = voices.find((v) => /CN|SG/.test(v.lang)) || voices[0];
  speech.lang = speech.voice.lang;
  speech.rate = 0.85;
  globalThis.speechSynthesis.speak(speech);
}
