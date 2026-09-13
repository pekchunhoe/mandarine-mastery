import { escapeHTML as e, highlight, normalize } from '../js/utils.js';
import { expansions, practiceExample } from '../data/content.js';
import { productionEligible } from '../js/writing-checks.js';
import { state, persist } from '../js/state.js';
export function sentenceExpansion(root, ctx) {
  const data = expansions[ctx.item.word],
    upgrade = ctx.activity.id === 'upgrade';
  if (!data || ctx.difficulty === 'hard' || upgrade) {
    const base = data?.base || practiceExample(ctx.item),
      key = `expand:${ctx.item.id}`;
    root.innerHTML = `<h2>${upgrade ? '让句子更具体' : '给句子添一点细节'}</h2><p class="small muted">原句</p><p class="quote">${highlight(base, [ctx.item.word])}</p><div class="chip-tray"><span class="pill gold">什么时候？</span><span class="pill">在哪里？</span><span class="pill peach">怎样做？为什么？</span></div><p class="question-instruction">选一两项有用的细节就好。清楚自然，比一味写长更重要。</p><label for="expanded-writing">我的修改</label><textarea id="expanded-writing">${e(state.drafts[key]?.text || '')}</textarea><div class="check-row"><input type="checkbox" id="expansion-check"><label for="expansion-check">我保留了原来的意思，新加的细节也说得通。</label></div><button class="btn primary" id="save-expansion">对比并记录练习</button><p class="source-label">自动检查不会判断新细节是否合理，请请教老师。</p>`;
    root.querySelector('#expanded-writing').addEventListener(
      'input',
      (event) => {
        state.drafts[key] = {
          text: event.target.value,
          word: ctx.item.word,
          kind: 'sentence',
          at: new Date().toISOString(),
        };
        persist();
      },
      { signal: ctx.signal },
    );
    root.querySelector('#save-expansion').addEventListener(
      'click',
      () => {
        const text = root.querySelector('#expanded-writing').value.trim();
        if (!productionEligible(text, ctx.item.word) || normalize(text) === normalize(base)) {
          ctx.note('保留目标词语，添加或修改一两处具体的细节，再加上句末标点。');
          return;
        }
        if (!root.querySelector('#expansion-check').checked) {
          ctx.note('读一读原句和修改后的句子，完成自查。');
          return;
        }
        ctx.complete({
          kind: 'sentence',
          answer: text,
          message: `<p class="small">原句：${e(base)}</p><p>修改后：${highlight(text, [ctx.item.word])}</p><p>已记录修改练习。请和老师检查细节是否自然。</p>`,
          html: true,
        });
      },
      { signal: ctx.signal },
    );
    return;
  }
  let selected = { time: null, place: null, detail: null, reason: false };
  const result = () =>
    `${selected.time !== null ? data.time[selected.time] + '，' : ''}${selected.detail !== null ? data.detail[selected.detail] : ''}${data.who}${selected.place !== null ? data.place[selected.place] : ''}${data.action}${selected.reason ? '，' + data.reason : '。'}`;
  function draw() {
    root.innerHTML = `<h2>句子一点一点长大</h2><p class="small muted">原句：${e(data.base)}</p><p class="question-instruction">选择一两项有帮助的细节。再点一次就能拿走。</p><div class="build-groups">${[
      ['time', '什么时候？'],
      ['place', '在哪里？'],
      ['detail', '什么样的？'],
    ]
      .filter(([k]) => data[k].some(Boolean))
      .map(
        ([k, label]) =>
          `<div class="build-group"><h3>${label}</h3><div class="chip-tray">${data[k].map((v, i) => `<button class="word-chip ${selected[k] === i ? 'selected' : ''}" data-expand="${k}:${i}" aria-pressed="${selected[k] === i}">${e(v)}</button>`).join('')}</div></div>`,
      )
      .join(
        '',
      )}<div class="build-group"><h3>再加一点想法？（可选）</h3><button class="word-chip ${selected.reason ? 'selected' : ''}" data-expand="reason" aria-pressed="${selected.reason}">${e(data.reason)}</button></div></div><div class="sentence-display arrive" aria-live="polite">${selected.time !== null ? `<span class="expansion-piece time">${e(data.time[selected.time])}，</span>` : ''}${selected.detail !== null ? `<span class="expansion-piece detail">${e(data.detail[selected.detail])}</span>` : ''}${e(data.who)}${selected.place !== null ? `<span class="expansion-piece place">${e(data.place[selected.place])}</span>` : ''}<span class="expansion-piece action">${e(data.action)}</span>${selected.reason ? '，' + e(data.reason) : '。'}</div><button class="btn primary" id="finish-expansion">读读我的扩句</button>`;
  }
  draw();
  root.addEventListener(
    'click',
    (event) => {
      if (ctx.finished) return;
      const b = event.target.closest('[data-expand]');
      if (b) {
        const [k, i] = b.dataset.expand.split(':');
        selected[k] =
          k === 'reason' ? !selected.reason : selected[k] === Number(i) ? null : Number(i);
        draw();
      }
      if (event.target.closest('#finish-expansion')) {
        if (!Object.values(selected).some((v) => v !== null && v !== false)) {
          ctx.note('先选一项细节，看看它怎样丰富句子。');
          return;
        }
        ctx.complete({
          kind: 'guided',
          answer: result(),
          message: '你加入了具体细节！看看哪一项最有帮助。句子清楚自然就好，不需要把每一块都用上。',
        });
      }
    },
    { signal: ctx.signal },
  );
}
