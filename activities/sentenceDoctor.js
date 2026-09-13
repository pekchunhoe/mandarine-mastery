import { escapeHTML as e, normalize, highlight } from '../js/utils.js';
import { practiceExample } from '../data/content.js';
const cases = {
  沟通: {
    parts: ['小明', '非常沟通地', '告诉妈妈这件事。'],
    bad: 1,
    fix: '小明把这件事告诉妈妈，并和她好好沟通。',
    why: '沟通是交流想法的动作，不能说“非常沟通地”。',
  },
  兴奋: {
    parts: ['听到郊游的消息，', '兴奋我', '跳了起来。'],
    bad: 1,
    fix: '听到郊游的消息，我兴奋得跳了起来。',
    why: '先写谁，再写兴奋的表现：“我兴奋得跳了起来”。',
  },
  协助: {
    parts: ['放学后，', '我协助协助老师', '整理图书。'],
    bad: 1,
    fix: '放学后，我协助老师整理图书。',
    why: '“协助”不小心重复写了，保留一个即可。',
  },
  解决: {
    parts: ['大家一起', '解决了一杯橙汁', '。'],
    bad: 1,
    fix: '大家一起解决了这道难题。',
    why: '可以解决问题或难题，不能用“解决”表示喝橙汁。',
  },
  尽力: {
    parts: ['我会', '尽力尽力', '完成这次任务。'],
    bad: 1,
    fix: '我会尽力完成这次任务。',
    why: '“尽力”不小心重复写了，删去多余的一个，意思就清楚了。',
  },
  修理: {
    parts: ['爸爸正在', '修理修理', '坏掉的风扇。'],
    bad: 1,
    fix: '爸爸正在修理坏掉的风扇。',
    why: '这里描述正在做的动作，不需要把“修理”再写一次。',
  },
};
export function sentenceDoctor(root, ctx) {
  const text = practiceExample(ctx.item),
    index = text.indexOf(ctx.item.word);
  const data = cases[ctx.item.word] || {
    parts: [
      text.slice(0, index),
      ctx.item.word + ctx.item.word,
      text.slice(index + ctx.item.word.length),
    ],
    bad: 1,
    fix: text,
    why: `抄写时，“${ctx.item.word}”被重复输入了。删去多余的一个，恢复原句。`,
  };
  let found = false;
  root.innerHTML = `<h2>给句子做一次小检查</h2><p class="question-instruction">${cases[ctx.item.word] ? '这句话有一处用词或顺序问题。' : '抄写时，有一个词语不小心被输入了两次。'}先点出有问题的部分，再动手修改。</p><div class="sentence-display">${data.parts.map((part, i) => (part ? `<button class="doctor-piece" data-part="${i}">${e(part)}</button>` : '')).join('')}</div><div id="doctor-fix" hidden><label for="corrected-sentence">我的修改</label><textarea id="corrected-sentence">${e(data.parts.join(''))}</textarea><div class="action-bar"><button class="btn primary" id="check-doctor">检查修改</button><button class="btn" id="doctor-help">看修改建议</button></div></div>`;
  root.addEventListener(
    'click',
    (event) => {
      if (ctx.finished) return;
      const b = event.target.closest('[data-part]');
      if (b) {
        if (Number(b.dataset.part) === data.bad) {
          found = true;
          b.classList.add('selected');
          root.querySelector('#doctor-fix').hidden = false;
          ctx.note('找到问题了！现在试着改一改。');
        } else ctx.fail('再读一读，哪一部分用得不合适？', b.textContent, 'context');
      }
      if (event.target.closest('#doctor-help')) {
        ctx.hintUsed();
        ctx.note(`修改建议：${data.fix} ${data.why}`);
      }
      if (event.target.closest('#check-doctor') && found) {
        const answer = root.querySelector('#corrected-sentence').value;
        if (normalize(answer) === normalize(data.fix))
          ctx.complete({
            kind: 'guided',
            answer,
            message: `${highlight(data.fix, [ctx.item.word])}<p class="small">${e(data.why)}</p>`,
            html: true,
          });
        else ctx.note('还没有还原建议改法。你也可以请老师检查自己的其他改法。');
      }
    },
    { signal: ctx.signal },
  );
}
