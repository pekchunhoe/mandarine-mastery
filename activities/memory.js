import { escapeHTML as e, shuffle, unique } from '../js/utils.js';
import { practiceExample } from '../data/content.js';
export function memory(root, ctx) {
  const count = { easy: 3, medium: 4, hard: 6 }[ctx.difficulty];
  const words = [];
  for (const candidate of unique([ctx.item, ...shuffle(ctx.pool)], (w) => w.word)) {
    // Each displayed sentence must belong unambiguously to one displayed word.
    if (
      words.some(
        (w) =>
          practiceExample(w).includes(candidate.word) ||
          practiceExample(candidate).includes(w.word),
      )
    )
      continue;
    words.push(candidate);
    if (words.length === count) break;
  }
  const cards = shuffle(
    words.flatMap((w, pair) => [
      { pair, text: w.word },
      { pair, text: practiceExample(w) },
    ]),
  );
  let open = [],
    matched = new Set(),
    locked = false,
    timer;
  function draw() {
    root.innerHTML = `<h2>词语和句子，谁是一对？</h2><p class="question-instruction">一次翻两张。找出词语对应的参考句。</p><p class="small muted">已找到 ${matched.size} / ${words.length} 对</p><div class="memory-board">${cards
      .map((c, i) => {
        const shown = open.includes(i) || matched.has(c.pair);
        return `<button class="memory-card ${matched.has(c.pair) ? 'matched' : shown ? 'flipped' : ''}" data-card="${i}" ${matched.has(c.pair) ? 'disabled' : ''} aria-label="${shown ? e(c.text) : `翻开第${i + 1}张卡片`}">${shown ? `${matched.has(c.pair) ? '✓ ' : ''}${e(c.text)}` : '✳'}</button>`;
      })
      .join('')}</div>`;
  }
  draw();
  root.addEventListener(
    'click',
    (event) => {
      const b = event.target.closest('[data-card]');
      if (!b || locked || ctx.finished) return;
      const i = Number(b.dataset.card);
      if (open.includes(i) || matched.has(cards[i].pair)) return;
      open.push(i);
      draw();
      if (open.length === 2) {
        if (cards[open[0]].pair === cards[open[1]].pair) {
          matched.add(cards[i].pair);
          open = [];
          draw();
          if (matched.size === words.length)
            ctx.complete({
              kind: 'context',
              items: words,
              answer: words.map((w) => w.word).join(''),
              message: '全部配对成功！词语和情境一起记，更容易记得牢。',
            });
        } else {
          locked = true;
          ctx.fail(
            '这两张还不是一对。记住位置，再试一次。',
            open.map((x) => cards[x].text).join('|'),
            'context',
          );
          timer = setTimeout(() => {
            open = [];
            locked = false;
            draw();
          }, 1100);
        }
      }
    },
    { signal: ctx.signal },
  );
  ctx.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
}
