import { escapeHTML as e, highlight, normalize, shuffle } from '../js/utils.js';
import { distractors, practiceExample, editorial } from '../data/content.js';
export function cloze(root, ctx) {
  const item = ctx.item,
    text = practiceExample(item);
  const allowed = (distractors[item.word] || []).filter((word) =>
    ctx.pool.some((w) => w.word === word),
  );
  const count = ctx.difficulty === 'medium' ? 2 : 4;
  const typed = ctx.difficulty === 'hard' || allowed.length < count - 1;
  const recallMode = typed && ctx.difficulty !== 'hard';
  const options = shuffle([item.word, ...shuffle(allowed).slice(0, count - 1)]);
  const blank = text
    .split(item.word)
    .map(e)
    .join('<span class="blank" aria-label="填空">　？　</span>');
  root.innerHTML = `<h2>${typed ? '把记住的词语写出来' : '跟着句子找线索'}</h2><p class="question-instruction">${recallMode ? '先看参考句，再收起它，试着回忆原来的词语。' : '读一读，补回参考句里的词语。'}</p>${recallMode ? `<div id="study-reference" class="notice">${highlight(text, [item.word])}<div><button class="btn" id="hide-reference">我记住了，开始填空</button></div></div>` : ''}<div id="cloze-question" ${recallMode ? 'hidden' : ''}><div class="sentence-display">${blank}</div>${typed ? '<label for="cloze-answer">你的词语</label><input id="cloze-answer" class="answer-input" autocomplete="off" placeholder="在这里输入"><button class="btn primary" id="submit-cloze">检查答案</button>' : `<div class="answer-grid">${options.map((w) => `<button class="word-chip" data-answer="${e(w)}">${e(w)}</button>`).join('')}</div>`}</div><p class="source-label">${editorial[item.word] ? '补充教学例句' : '词表参考句'} · 回忆原句</p>`;
  function check(answer) {
    if (ctx.finished) return;
    if (normalize(answer) === normalize(item.word)) {
      ctx.complete({
        kind: typed ? 'recall' : 'context',
        answer: item.word,
        message: highlight(text, [item.word]),
        html: true,
      });
    } else ctx.fail('再想一想。这个词语在原句中怎样使用？', answer, typed ? 'recall' : 'context');
  }
  root.addEventListener(
    'click',
    (event) => {
      const choice = event.target.closest('[data-answer]');
      if (choice) check(choice.dataset.answer);
      if (event.target.closest('#submit-cloze')) check(root.querySelector('#cloze-answer').value);
      if (event.target.closest('#hide-reference')) {
        root.querySelector('#study-reference').hidden = true;
        root.querySelector('#cloze-question').hidden = false;
        root.querySelector('#cloze-answer')?.focus();
      }
    },
    { signal: ctx.signal },
  );
  root.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter' && event.target.id === 'cloze-answer' && !event.isComposing)
        check(event.target.value);
    },
    { signal: ctx.signal },
  );
}
