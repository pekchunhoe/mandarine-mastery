import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SENTENCE_SCENARIO_GROUPS, CUSTOM_SENTENCE_SCENARIO } from '../data/sentence-scenarios.js';
import { copyText } from '../js/clipboard.js';
import { copyEssayText } from '../activities/essayTraining.js';

test('sentence scenarios cover five areas with 50 distinct presets and the existing custom option', () => {
  assert.deepEqual(SENTENCE_SCENARIO_GROUPS.map((group) => group.label), ['学校生活', '朋友同学', '家庭生活', '日常生活', '特别经历']);
  const presets = SENTENCE_SCENARIO_GROUPS.flatMap((group) => group.options);
  assert.equal(presets.length, 50);
  assert.equal(new Set(presets).size, 50);
  for (const group of SENTENCE_SCENARIO_GROUPS) assert.equal(group.options.length, 10);
  for (const previous of ['在学校', '和家人相处', '与朋友一起']) assert.ok(presets.includes(previous));
  assert.equal(presets[0], '在学校');
  assert.equal(CUSTOM_SENTENCE_SCENARIO, '你自己想到的情境');
});

test('the existing essay copy API uses the same compatible shared helper', () => {
  assert.equal(copyEssayText, copyText);
});

test('clipboard receives exact Chinese text, punctuation, whitespace and line breaks', async () => {
  const text = '  我因为懒惰，没有完成老师给我的功课。\n\n我想：“明天要认真！”\n';
  let received;
  assert.equal(await copyText(text, { navigatorRef: { clipboard: { writeText: async (value) => { received = value; } } } }), true);
  assert.equal(received, text);
});

test('clipboard fallback cleans up, restores focus and reports denied copying without throwing', async () => {
  for (const result of [true, false, 'throw']) {
    let selected = false, removed = false, restoredFocus = false;
    const field = { value: '', style: {}, setAttribute() {}, focus() {}, select() { selected = true; }, remove() { removed = true; } };
    const documentRef = {
      createElement: () => field,
      body: { appendChild() {} },
      activeElement: { focus() { restoredFocus = true; } },
      execCommand(command) {
        assert.equal(command, 'copy');
        assert.equal(field.value, '我的句子。\n下一行！');
        if (result === 'throw') throw new Error('Copy denied');
        return result;
      },
    };
    assert.equal(await copyText('我的句子。\n下一行！', {
      navigatorRef: { clipboard: { writeText: async () => { throw new Error('Permission denied'); } } }, documentRef,
    }), result === true);
    assert.ok(selected && removed && restoredFocus);
  }
});

test('empty text or missing clipboard support fails without copying unrelated content', async () => {
  assert.equal(await copyText('', { navigatorRef: { clipboard: { writeText: () => assert.fail('unexpected copy') } } }), false);
  assert.equal(await copyText('句子。', { navigatorRef: {}, documentRef: {} }), false);
});
