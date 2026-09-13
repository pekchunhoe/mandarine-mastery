import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWriting, productionEligible } from '../js/writing-checks.js';
import { highlight, normalize } from '../js/utils.js';
test('Writing checks count Chinese characters and targets without assigning semantic scores', () => {
  const r = checkWriting(
    '今天，我和伙伴一起沟通。\n最后，我们解决了问题。',
    ['沟通', '伙伴', '协助'],
    { time: '今天' },
  );
  assert.equal(r.count, 19);
  assert.equal(r.paragraphs, 2);
  assert.deepEqual(r.used, ['沟通', '伙伴']);
  assert.equal(r.planCount, 1);
  assert.equal(r.score, undefined);
  assert.equal(r.grammarCorrect, undefined);
});
test('Punctuation, repeated connectors and long sentences have objective warnings', () => {
  const r = checkWriting('然后我们走了然后我们看了然后我们跑了' + '小明在公园里散步'.repeat(8));
  assert.equal(r.repeated[0].count, 3);
  assert.equal(r.long.length, 1);
  assert.ok(r.messages.some((m) => m.includes('标点') || m.includes('句号')));
});
test('Blank, isolated words and reference-learning boilerplate do not count as production', () => {
  assert.equal(productionEligible('沟通。', '沟通'), false);
  assert.equal(productionEligible('我今天学习了沟通这个词语。', '沟通'), false);
  assert.equal(productionEligible('发生误会后，我们坐下来耐心沟通。', '沟通'), true);
});
test('Student HTML stays text and overlapping vocabulary highlights longest matches first', () => {
  const html = highlight('<img src=x onerror=alert(1)>钥匙扣和钥匙', ['钥匙', '钥匙扣']);
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('<mark>钥匙扣</mark>'));
  assert.ok(html.includes('&lt;img'));
  assert.equal(normalize(' 沟 通！'), '沟通');
});
