import { escapeHTML as e, shuffle, unique } from '../js/utils.js';
export function recognition(root, ctx) {
  const correct = unique(
    ctx.pool.filter((w) => w.word.includes(ctx.item.character)),
    (w) => w.word,
  ).slice(0, 3);
  const choices = shuffle([
    ...correct,
    ...shuffle(
      unique(
        ctx.pool.filter((w) => !w.word.includes(ctx.item.character)),
        (w) => w.word,
      ),
    ).slice(0, 3),
  ]);
  const found = new Set();
  root.innerHTML = `<h2>找出含有“${e(ctx.item.character)}”的词语。</h2><p class="question-instruction">可以选多个。看清楚，再轻轻点一下。</p><div class="target-character">${e(ctx.item.character)}</div><div class="answer-grid">${choices.map((w, i) => `<button class="word-chip" data-choice="${i}">${e(w.word)}</button>`).join('')}</div><div class="collection"><span class="small muted">我的词语收藏区</span><div class="chip-tray" id="collected"></div></div>`;
  root.addEventListener(
    'click',
    (event) => {
      const b = event.target.closest('[data-choice]');
      if (!b || ctx.finished) return;
      const w = choices[Number(b.dataset.choice)];
      if (w.word.includes(ctx.item.character)) {
        if (found.has(w.word)) return;
        found.add(w.word);
        b.classList.add('correct');
        b.disabled = true;
        root
          .querySelector('#collected')
          .insertAdjacentHTML(
            'beforeend',
            `<span class="word-chip correct arrive">✓ ${e(w.word)}</span>`,
          );
        if (found.size === correct.length)
          ctx.complete({
            kind: 'recognition',
            items: correct,
            answer: correct.map((x) => x.word).join(' '),
            message: '你找齐了！这些词语都含有这个生字。',
          });
      } else {
        b.classList.remove('wrong');
        void b.offsetWidth;
        b.classList.add('wrong');
        ctx.fail('看看词语里有没有这个生字。', w.word, 'recognition');
      }
    },
    { signal: ctx.signal },
  );
}
