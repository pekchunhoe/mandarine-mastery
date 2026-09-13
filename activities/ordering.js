import { escapeHTML as e, shuffle, highlight } from '../js/utils.js';
import { sentenceChunks, practiceExample, paragraphs } from '../data/content.js';
import { enableDrag } from '../components/drag.js';
import { freeSentence } from './sentenceBuilder.js';
export function ordering(root, ctx) {
  const paragraphMode = ctx.activity.id === 'paragraph';
  const choices = paragraphs.filter((p) =>
    p.words.some((word) => ctx.pool.some((w) => w.word === word)),
  );
  const story = choices[ctx.round % Math.max(1, choices.length)];
  const chunks = paragraphMode ? story?.sentences : sentenceChunks(ctx.item);
  if (!chunks || chunks.length < 2) {
    freeSentence(root, ctx);
    root.insertAdjacentHTML(
      'afterbegin',
      '<p class="notice">这句话暂时没有合适的短语分块。先用同一个词语练习自主造句。</p>',
    );
    return;
  }
  const tiles = shuffle(chunks.map((text, id) => ({ text, id })));
  let order = [];
  function draw() {
    root.innerHTML = `<h2>${paragraphMode ? e(story.title) : '让短语连成一句话'}</h2><p class="question-instruction">${paragraphMode ? '想想事情的先后。' : '读一读各个短语。'}拖动或依次点选；点上方已选的卡片，可以退回重排。</p><div class="tile-answer" data-drop="answer" aria-label="${paragraphMode ? '我的段落' : '我的句子'}">${order.length ? order.map((id, i) => `<button class="tile ${paragraphMode ? 'paragraph-tile' : ''}" data-remove="${id}" data-drag="${id}" data-drop="at-${i}"><span class="tile-number">${i + 1}</span>${e(chunks[id])}</button>`).join('') : '<span class="small muted">把卡片放到这里……</span>'}</div><div class="tile-bank" data-drop="bank">${tiles
      .filter((t) => !order.includes(t.id))
      .map(
        (t) =>
          `<button class="tile ${paragraphMode ? 'paragraph-tile' : ''}" data-add="${t.id}" data-drag="${t.id}">${e(t.text)}</button>`,
      )
      .join(
        '',
      )}</div><div class="action-bar"><button class="btn primary" id="check-order" ${order.length !== chunks.length ? 'disabled' : ''}>${paragraphMode ? '读读我的段落' : '拼好了，检查'}</button><button class="btn" id="clear-order">重新排列</button></div>`;
  }
  function move(id, to) {
    if (ctx.finished) return;
    order = order.filter((x) => x !== id);
    if (to === 'answer') order.push(id);
    else if (to.startsWith('at-')) order.splice(Number(to.slice(3)), 0, id);
    draw();
  }
  draw();
  enableDrag(root, (id, to) => move(Number(id), to), ctx.signal);
  root.addEventListener(
    'click',
    (event) => {
      if (ctx.finished) return;
      const add = event.target.closest('[data-add]'),
        remove = event.target.closest('[data-remove]');
      if (add) move(Number(add.dataset.add), 'answer');
      if (remove) move(Number(remove.dataset.remove), 'bank');
      if (event.target.closest('#clear-order')) {
        order = [];
        draw();
      }
      if (event.target.closest('#check-order')) {
        const answer = order.map((i) => chunks[i]).join('');
        if (answer === chunks.join('')) {
          const items = paragraphMode
            ? ctx.pool.filter((w) => story.words.includes(w.word) && answer.includes(w.word))
            : [ctx.item];
          ctx.complete({
            kind: 'guided',
            items: items.length ? items : [],
            answer,
            message: paragraphMode
              ? `<p>${e(story.explanation)}</p><p>${highlight(
                  answer,
                  items.map((w) => w.word),
                )}</p>`
              : `<p>${highlight(practiceExample(ctx.item), [ctx.item.word])}</p><p class="small">先读开头，再看发生了什么。短语连起来，意思才完整。</p>`,
            html: true,
          });
        } else
          ctx.fail(
            paragraphMode ? '再看看哪件事先发生，哪一句是结果。' : '再读一次，看看短语怎样接起来。',
            answer,
            'guided',
          );
      }
    },
    { signal: ctx.signal },
  );
}
