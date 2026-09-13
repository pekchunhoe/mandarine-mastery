import { test } from 'node:test';
import assert from 'node:assert/strict';

class MockUtterance {
  constructor(text) { this.text = text; }
}

test('Mandarin voice selection prioritizes Mainland Mandarin and excludes Cantonese', async () => {
  const service = await import(`../js/speech-service.js?selection=${Date.now()}`);
  const mainland = { name: 'Mandarin China', lang: 'zh-CN' };
  assert.equal(service.selectMandarinVoice([{ name: 'Chinese Hong Kong', lang: 'zh-HK' }, mainland]), mainland);
  assert.equal(service.selectMandarinVoice([{ name: 'Cantonese', lang: 'zh-HK' }, { name: 'Taiwan Chinese', lang: 'zh-TW' }]).lang, 'zh-TW');
  assert.equal(service.selectMandarinVoice([{ name: 'Cantonese', lang: 'yue-HK' }]), null);
  assert.equal(service.selectMandarinVoice([{ name: 'Cantonese', lang: 'zh-CN' }]), null);
  assert.equal(service.selectMandarinVoice([{ name: 'Google Putonghua', lang: 'zh-SG' }]).name, 'Google Putonghua');
  assert.equal(service.isCantoneseVoice({ name: '\u5ee3\u6771\u8a71', lang: 'zh-TW' }), true);
});

test('Mandarin speech service ignores blanks, selects Mandarin and replaces active speech', async () => {
  const previousSpeech = globalThis.speechSynthesis;
  const previousUtterance = globalThis.SpeechSynthesisUtterance;
  const previousStorage = globalThis.localStorage;
  const calls = [];
  globalThis.localStorage = { getItem: () => null, setItem: (key, value) => calls.push(['store', key, value]) };
  globalThis.SpeechSynthesisUtterance = MockUtterance;
  globalThis.speechSynthesis = {
    getVoices: () => [{ lang: 'en-US' }, { name: 'Taiwan Chinese', lang: 'zh-TW' }, { name: 'Mandarin China', lang: 'zh-CN' }, { name: 'Chinese Hong Kong', lang: 'zh-HK' }],
    addEventListener() {}, cancel: () => calls.push(['cancel']), speak: (item) => calls.push(['speak', item]),
    pause: () => calls.push(['pause']), resume: () => calls.push(['resume']),
  };
  try {
    const service = await import(`../js/speech-service.js?test=${Date.now()}`);
    service.initSpeech();
    assert.equal(service.speak('   '), false);
    assert.equal(service.speak('你好，世界。'), true);
    assert.equal(calls.at(-1)[1].lang, 'zh-CN');
    assert.equal(calls.at(-1)[1].voice.name, 'Mandarin China');
    assert.equal(calls.at(-1)[1].rate, 1);
    service.setSpeechRate(0.75);
    service.speak('第二句。');
    assert.equal(calls.at(-1)[1].rate, 0.75);
    assert.ok(calls.filter(([name]) => name === 'cancel').length >= 2);
    assert.equal(service.pause(), true);
    assert.equal(service.resume(), true);
    service.stop();
    assert.equal(service.isSpeaking(), false);
  } finally {
    globalThis.speechSynthesis = previousSpeech;
    globalThis.SpeechSynthesisUtterance = previousUtterance;
    globalThis.localStorage = previousStorage;
  }
});

test('no confirmed Mandarin voice leaves voice unassigned and requests zh-CN', async () => {
  const previousSpeech = globalThis.speechSynthesis;
  const previousUtterance = globalThis.SpeechSynthesisUtterance;
  const calls = [];
  globalThis.SpeechSynthesisUtterance = MockUtterance;
  globalThis.speechSynthesis = {
    getVoices: () => [{ name: 'Cantonese', lang: 'zh-HK' }, { name: 'Cantonese Yue', lang: 'yue-HK' }],
    addEventListener() {}, cancel() {}, speak: (item) => calls.push(item), pause() {}, resume() {},
  };
  try {
    const service = await import(`../js/speech-service.js?fallback=${Date.now()}`);
    service.initSpeech();
    assert.equal(service.speak('\u4f60\u597d'), true);
    assert.equal(calls.at(-1).lang, 'zh-CN');
    assert.equal(calls.at(-1).voice, undefined);
  } finally {
    globalThis.speechSynthesis = previousSpeech;
    globalThis.SpeechSynthesisUtterance = previousUtterance;
  }
});

test('essay sentence playback sequences, pauses, completes and clears its active state', async () => {
  const previousSpeech = globalThis.speechSynthesis;
  const previousUtterance = globalThis.SpeechSynthesisUtterance;
  const calls = [], starts = [], ends = [];
  globalThis.SpeechSynthesisUtterance = MockUtterance;
  globalThis.speechSynthesis = {
    getVoices: () => [{ name: 'Mandarin China', lang: 'zh-CN' }], addEventListener() {},
    cancel: () => calls.push(['cancel']), speak: (item) => calls.push(['speak', item]),
    pause: () => calls.push(['pause']), resume: () => calls.push(['resume']),
  };
  try {
    const service = await import(`../js/speech-service.js?sequence=${Date.now()}`);
    service.initSpeech();
    assert.equal(service.speakSequence(['第一句。', '第二句。'], { onSentenceStart: (index) => starts.push(index), onSentenceEnd: (index) => ends.push(index) }), true);
    const first = calls.at(-1)[1];
    assert.deepEqual(starts, [0]);
    assert.equal(first.lang, 'zh-CN');
    assert.equal(service.pause(), true);
    assert.deepEqual(starts, [0]);
    assert.equal(service.resume(), true);
    first.onend();
    const second = calls.at(-1)[1];
    assert.deepEqual(starts, [0, 1]);
    second.onend();
    assert.deepEqual(ends, [0, 1]);
    assert.equal(service.isSpeaking(), false);
  } finally {
    globalThis.speechSynthesis = previousSpeech;
    globalThis.SpeechSynthesisUtterance = previousUtterance;
  }
});

test('stopping or replacing an essay sequence prevents stale sentences from starting', async () => {
  const previousSpeech = globalThis.speechSynthesis;
  const previousUtterance = globalThis.SpeechSynthesisUtterance;
  const calls = [], stopped = [];
  globalThis.SpeechSynthesisUtterance = MockUtterance;
  globalThis.speechSynthesis = {
    getVoices: () => [{ name: 'Mandarin China', lang: 'zh-CN' }], addEventListener() {},
    cancel: () => calls.push(['cancel']), speak: (item) => calls.push(['speak', item]), pause() {}, resume() {},
  };
  try {
    const service = await import(`../js/speech-service.js?replacement=${Date.now()}`);
    service.initSpeech();
    service.speakSequence(['甲一。', '甲二。'], { onStop: () => stopped.push('A') });
    const firstA = calls.at(-1)[1];
    service.speakSequence(['乙一。', '乙二。'], { onStop: () => stopped.push('B') });
    const firstB = calls.at(-1)[1];
    firstA.onend();
    assert.equal(calls.at(-1)[1], firstB);
    assert.deepEqual(stopped, ['A']);
    service.stop();
    firstB.onend();
    assert.deepEqual(stopped, ['A', 'B']);
    assert.equal(calls.filter(([name]) => name === 'speak').length, 2);
  } finally {
    globalThis.speechSynthesis = previousSpeech;
    globalThis.SpeechSynthesisUtterance = previousUtterance;
  }
});
