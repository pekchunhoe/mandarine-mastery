import { escapeHTML as e, shuffle, unique } from '../js/utils.js';
import { enableDrag } from '../components/drag.js';
export function matching(root, ctx) {
  const chars = unique([ctx.item, ...shuffle(ctx.pool)], (w) => w.character)
    .slice(0, 3)
    .map((w) => w.character);
  const words = shuffle(
    unique(
      chars.flatMap((ch) => ctx.pool.filter((w) => w.character === ch).slice(0, 2)),
      (w) => w.word,
    ),
  );
  const placed = new Map();
  let selected = null;
  function draw() {
    root.innerHTML = `<h2>把词语送回生字的家</h2><p class="question-instruction">拖动词语，或先点词语，再点生字。一个词含有两个生字时，任一个合适的家都可以。</p><div class="match-targets">${chars
      .map(
        (ch) =>
          `<button class="match-target" data-target="${e(ch)}" data-drop="${e(ch)}" aria-label="放到生字${e(ch)}">${e(ch)}${[
            ...placed,
          ]
            .filter(([, v]) => v === ch)
            .map(([id]) => `<span class="word-chip correct">✓ ${e(words[id].word)}</span>`)
            .join('')}</button>`,
      )
      .join(
        '',
      )}</div><div class="tile-bank">${words.map((w, i) => (placed.has(i) ? '' : `<button class="tile ${selected === i ? 'selected' : ''}" data-word="${i}" data-drag="${i}" aria-pressed="${selected === i}">${e(w.word)}</button>`)).join('')}</div>`;
  }
  function place(index, char) {
    const w = words[index];
    if (!w || placed.has(index) || ctx.finished) return;
    if (w.word.includes(char)) {
      placed.set(index, char);
      selected = null;
      draw();
      if (placed.size === words.length)
        ctx.complete({
          kind: 'recognition',
          items: words,
          answer: words.map((w) => w.word).join(''),
          message: '配对完成！读一读这些词语。',
        });
    } else ctx.fail('再看看这个词语包含哪个生字。', `${w.word}→${char}`, 'recognition');
  }
  draw();
  enableDrag(root, (id, target) => place(Number(id), target), ctx.signal);
  root.addEventListener(
    'click',
    (event) => {
      const word = event.target.closest('[data-word]');
      if (word) {
        selected = Number(word.dataset.word);
        draw();
        return;
      }
      const target = event.target.closest('[data-target]');
      if (target && selected !== null) place(selected, target.dataset.target);
    },
    { signal: ctx.signal },
  );
}
