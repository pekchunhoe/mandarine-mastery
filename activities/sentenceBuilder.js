import { escapeHTML as e, highlight, normalize } from '../js/utils.js';
import { builders, practiceExample } from '../data/content.js';
import { productionEligible } from '../js/writing-checks.js';
import { state, persist } from '../js/state.js';
import { enableDrag } from '../components/drag.js';
export function freeSentence(root, ctx) {
  const key = `sentence:${ctx.item.id}`,
    saved = state.drafts[key]?.text || '';
  const situations = ['在学校', '和家人相处', '与朋友一起', '你自己想到的情境'];
  root.innerHTML = `<h2>轮到你来造句</h2><div class="target-word">${e(ctx.item.word)}</div><p class="question-instruction">想想谁在什么地方，做了什么。用这个词语，写一句发生在生活中的话。</p><details class="reference-details" ${ctx.difficulty === 'easy' ? 'open' : ''}><summary>看看参考用法</summary><p class="quote">${highlight(practiceExample(ctx.item), [ctx.item.word])}</p></details><label for="sentence-context">我想写的情境</label><select id="sentence-context">${situations.map((x) => `<option>${x}</option>`).join('')}</select><label for="own-sentence" style="margin-top:16px">我的句子</label><textarea id="own-sentence" placeholder="把人物、事情和想法写清楚。">${e(saved)}</textarea><p class="save-status" id="sentence-save">草稿保存在这台设备</p><div class="check-row"><input type="checkbox" id="sentence-selfcheck"><label for="sentence-selfcheck">我读过一遍，确认词语用在真实的情境里。</label></div><button class="btn primary" id="submit-sentence">记录我的造句练习</button><p class="source-label">自动检查只检查用词、字数与标点。句意和用法请和老师一起读一读。</p>`;
  root.querySelector('#own-sentence').addEventListener(
    'input',
    (event) => {
      state.drafts[key] = {
        text: event.target.value,
        word: ctx.item.word,
        at: new Date().toISOString(),
        kind: 'sentence',
      };
      const ok = persist();
      root.querySelector('#sentence-save').textContent = ok
        ? '✓ 草稿已保存'
        : '尚未保存，请复制句子';
    },
    { signal: ctx.signal },
  );
  root.querySelector('#submit-sentence').addEventListener(
    'click',
    () => {
      const text = root.querySelector('#own-sentence').value.trim();
      if (!productionEligible(text, ctx.item.word)) {
        ctx.note('请把这个词语写进一个具体情境，写清楚事情，并加上句末标点。');
        return;
      }
      if (normalize(text) === normalize(practiceExample(ctx.item))) {
        ctx.note('这是参考句。请换一个人物、事情或情境，写出自己的句子。');
        return;
      }
      if (!root.querySelector('#sentence-selfcheck').checked) {
        ctx.note('先读一读自己的句子，再勾选自查。');
        return;
      }
      ctx.complete({
        kind: 'sentence',
        answer: text,
        message: '已记录你的自主造句练习。请把句子读给老师或家人听，看看词语用得是否自然。',
      });
    },
    { signal: ctx.signal },
  );
}
export function sentenceBuilder(root, ctx) {
  const data = builders[ctx.item.word];
  if (!data || ctx.difficulty === 'hard' || ctx.params.get('mode') === 'free') {
    freeSentence(root, ctx);
    return;
  }
  const groups = [
    ['when', '什么时候'],
    ['who', '谁'],
    ['event', '事情 / 动作'],
    ['action', '结果 / 感受'],
  ];
  let selected = {};
  const sentence = () =>
    groups.every(([k]) => selected[k] !== undefined)
      ? `${data.when[selected.when]}，${data.who[selected.who]}${data.event[selected.event]}${data.action[selected.action]}。`
      : '';
  function draw() {
    root.innerHTML = `<h2>用积木，搭出不同的句子</h2><div class="row"><div class="target-word">${e(ctx.item.word)}</div><span class="pill">每组选择一块</span></div><p class="question-instruction">点选积木，或把积木拖进下面的句子区。换一种组合，也能说得通。</p><div class="build-groups">${groups.map(([key, label]) => `<section class="build-group"><h3>${label}</h3><div class="chip-tray">${data[key].map((text, i) => `<button class="word-chip tile ${selected[key] === i ? 'selected' : ''}" data-part="${key}:${i}" data-drag="${key}:${i}" aria-pressed="${selected[key] === i}">${e(text)}</button>`).join('')}</div></section>`).join('')}</div><div class="sentence-display" data-drop="sentence" aria-live="polite">${sentence() ? highlight(sentence(), [ctx.item.word]) : '选好四组积木，看看你的句子。'}</div><div class="action-bar"><button class="btn primary" id="finish-builder" ${sentence() ? '' : 'disabled'}>读读我的句子</button><a class="btn" href="#activity/builder?word=${encodeURIComponent(ctx.item.id)}&mode=free">挑战：自己写一句</a></div>`;
  }
  function choose(value) {
    if (ctx.finished) return;
    const [key, index] = value.split(':');
    selected[key] = Number(index);
    draw();
  }
  draw();
  enableDrag(
    root,
    (id, target) => {
      if (target === 'sentence') choose(id);
    },
    ctx.signal,
  );
  root.addEventListener(
    'click',
    (event) => {
      const part = event.target.closest('[data-part]');
      if (part) choose(part.dataset.part);
      if (event.target.closest('#finish-builder') && sentence())
        ctx.complete({
          kind: 'guided',
          answer: sentence(),
          message: `${data.why} 你还可以怎样说？试着写出自己的第二句。`,
        });
    },
    { signal: ctx.signal },
  );
}
