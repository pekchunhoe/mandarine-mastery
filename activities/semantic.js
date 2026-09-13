import { vocabularyService } from '../js/vocabulary-service.js';
import { escapeHTML as e, shuffle, unique, highlight } from '../js/utils.js';
import {
  tagsFor,
  scenes,
  practiceExample,
  distractors,
  multipleExamples,
} from '../data/content.js';
import { freeSentence } from './sentenceBuilder.js';
export function semantic(root, ctx) {
  if (ctx.activity.id === 'multi') {
    freeSentence(root, ctx);
    const examples = multipleExamples[ctx.item.word];
    root.insertAdjacentHTML(
      'afterbegin',
      `<div class="notice">一词多句：先看看参考用法，再换一个不同的生活情境。${examples ? '以下为补充教学例句。' : '写好后，换一个情境再写一句。'}</div>${examples ? examples.map(([context, text]) => `<div class="list-row"><span class="pill">${e(context)}</span><p class="no-margin">${highlight(text, [ctx.item.word])}</p></div>`).join('') : ''}`,
    );
    return;
  }
  if (ctx.activity.id === 'network') {
    const relatives = unique(
      ctx.pool.filter((w) => w.character === ctx.item.character && w.word !== ctx.item.word),
      (w) => w.word,
    );
    const tags = tagsFor(ctx.item),
      contexts = ctx.item.essayTopics.map((title) => ({ title }));
    root.innerHTML = `<h2>从一个词，发现更多联系</h2><div class="network"><div class="network-center">${e(ctx.item.word)}</div><div class="network-branch"><h3>同一个生字 · ${e(ctx.item.character)}</h3><div class="chip-tray">${relatives.map((w) => `<button class="word-chip" data-word-card="${e(w.id)}">${e(w.word)}</button>`).join('') || '<p class="small muted">当前课次没有其他同字词语。</p>'}</div></div><div class="network-branch"><h3>可以这样整理</h3><p>${tags.length ? tags.map(e).join(' / ') : '读读参考句，想想它表示什么。'}</p>${contexts.map((t) => `<span class="pill">${e(t.title)}</span>`).join('')}</div></div><p class="quote">${highlight(practiceExample(ctx.item), [ctx.item.word])}</p><p class="small muted">同字词语不一定是近义词。留意每个词自己的用法。</p><a class="btn primary" href="#activity/builder?word=${encodeURIComponent(ctx.item.id)}&mode=free">把这个词写进句子</a><button class="btn" id="read-network">我读过了</button>`;
    if (ctx.item.collocations)
      root
        .querySelector('.network')
        .insertAdjacentHTML(
          'beforeend',
          `<section class="network-branch"><h3>常见搭配</h3><div class="chip-tray">${ctx.item.collocations.map((x) => `<span class="pill">${e(x)}</span>`).join('')}</div></section>`,
        );
    root.querySelector('#read-network').onclick = () =>
      ctx.complete({
        kind: 'recognition',
        answer: 'read-network',
        message: '已经记录阅读练习。接着试着自己造句吧。',
      });
    return;
  }
  if (ctx.activity.id === 'classify') {
    const tags = tagsFor(ctx.item);
    if (!tags.length) {
      root.innerHTML = `<h2>试着给这个词语分类</h2><div class="target-word">${e(ctx.item.word)}</div><p class="quote">${highlight(practiceExample(ctx.item), [ctx.item.word])}</p><p class="question-instruction">这个词还没有预设分类。结合句意，说说你的想法，再和老师讨论。</p><label for="open-category">我选择的类别</label><select id="open-category">${[...vocabularyService.values('category'), '其他'].map((c) => `<option>${e(c)}</option>`).join('')}</select><label for="category-reason" style="margin-top:14px">为什么这样分？</label><textarea id="category-reason" placeholder="这个词表示……"></textarea><button class="btn primary" id="save-category">记录我的分类想法</button>`;
      root.querySelector('#save-category').onclick = () => {
        const reason = root.querySelector('#category-reason').value.trim();
        if (reason.length < 3) {
          ctx.note('写下几个字，说说你的理由。');
          return;
        }
        ctx.complete({
          kind: 'recognition',
          answer: `${root.querySelector('#open-category').value}:${reason}`,
          message: '分类想法已记录为阅读练习。这个词的具体分类，请和老师一起讨论。',
        });
      };
      return;
    }
    root.innerHTML = `<h2>这个词语可以放在哪一类？</h2><div class="target-word">${e(ctx.item.word)}</div><p class="quote">${highlight(practiceExample(ctx.item), [ctx.item.word])}</p><p class="question-instruction">有些词语不止一种合理的分类。</p><div class="answer-grid">${[
      ...new Set([...vocabularyService.values('category'), ...tags]),
    ]
      .map((t) => `<button class="word-chip" data-category="${e(t)}">${e(t)}</button>`)
      .join('')}</div>`;
    root.addEventListener(
      'click',
      (event) => {
        const b = event.target.closest('[data-category]');
        if (!b || ctx.finished) return;
        if (tags.includes(b.dataset.category))
          ctx.complete({
            kind: 'context',
            answer: b.dataset.category,
            message: `可以！“${ctx.item.word}”可以归入：${tags.join('、')}。分类可以帮助你在写作时寻找词语。`,
          });
        else
          ctx.fail(
            '结合参考句，想想它表示动作、事物，还是一种感受。',
            b.dataset.category,
            'context',
          );
      },
      { signal: ctx.signal },
    );
    return;
  }
  const scene = scenes.find((s) => s.word === ctx.item.word);
  if (!scene) {
    root.innerHTML = `<h2>读情境，想想这个词的意思</h2><div class="scene-art" aria-hidden="true">📖 💭 ✏️</div><p class="sentence-display">${highlight(practiceExample(ctx.item), [ctx.item.word])}</p><p class="question-instruction">读一读，想象句子里发生的事。</p><label for="scene-meaning">“${e(ctx.item.word)}”在这里写出了什么？</label><textarea id="scene-meaning" placeholder="用自己的话说一说……"></textarea><button class="btn primary" id="save-scene-reading">记录我的理解</button><p class="source-label">这是开放练习。请老师一起看看你的理解。</p>`;
    root.querySelector('#save-scene-reading').onclick = () => {
      const answer = root.querySelector('#scene-meaning').value.trim();
      if (answer.length < 3) {
        ctx.note('用几个字说说你想到的情境。');
        return;
      }
      ctx.complete({
        kind: 'recognition',
        answer,
        message: '你的理解已记录为阅读练习。试着把这个词写进一个新情境吧。',
      });
    };
    return;
  }
  const others = (distractors[scene.word] || [])
    .filter((w) => ctx.pool.some((x) => x.word === w))
    .slice(0, 3);
  const options = shuffle([scene.word, ...others]);
  let picked = false;
  root.innerHTML = `<h2>哪个词最适合这个情境？</h2><div class="scene-art" aria-hidden="true">${scene.icon}</div><p class="sentence-display">${e(scene.scene)}</p>${others.length ? `<div class="answer-grid">${options.map((w) => `<button class="word-chip" data-scene="${e(w)}">${e(w)}</button>`).join('')}</div>` : `<p>试着使用：<strong>${e(scene.word)}</strong></p><button class="btn" data-scene="${e(scene.word)}">说说这个词为什么合适</button>`}<div id="scene-reason" hidden><label for="why-scene">为什么？</label><textarea id="why-scene" placeholder="因为他们正在……"></textarea><button class="btn primary" id="finish-scene">记录我的解释</button></div>`;
  root.addEventListener(
    'click',
    (event) => {
      if (ctx.finished) return;
      const b = event.target.closest('[data-scene]');
      if (b) {
        if (b.dataset.scene === scene.word) {
          picked = true;
          root.querySelector('#scene-reason').hidden = false;
          b.classList.add('correct');
        } else ctx.fail('看看人物正在做什么，或有什么感受。', b.dataset.scene, 'context');
      }
      if (event.target.closest('#finish-scene') && picked) {
        if (root.querySelector('#why-scene').value.trim().length < 3) {
          ctx.note('用几个字说说你想到的理由。');
          return;
        }
        ctx.complete({
          kind: 'context',
          answer: scene.word,
          message: `参考理由：${scene.why} 你写下的理由也可以和老师一起讨论。`,
        });
      }
    },
    { signal: ctx.signal },
  );
}
