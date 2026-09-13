import { escapeHTML as e, unique, dayKey } from '../js/utils.js';
import { tagsFor } from '../data/content.js';
import { getEssayTitles } from '../js/essay-title-service.js';
import { state, addTray, persist } from '../js/state.js';
import { checkWriting, productionEligible } from '../js/writing-checks.js';
export function treasure(root, ctx) {
  const helpTopic = getEssayTitles({ category: '帮助别人' })[0];
  const draftKey = `treasure:${state.settings.grade}:${state.settings.lesson}`;
  let paragraphDraft = state.drafts[draftKey]?.text || '';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayWords = state.history
    .filter((h) => !h.correct && h.at.startsWith(dayKey(yesterday)))
    .map((h) => h.word);
  const all = unique(ctx.pool, (w) => w.word),
    missions = [];
  for (const [label, test, wanted] of [
    ['表示动作的词语', (w) => tagsFor(w).includes('动作'), 2],
    ['表示心情的词语', (w) => tagsFor(w).includes('心情'), 1],
    ['可以写进“帮助别人”的词语', (w) => helpTopic && w.essayTopics.includes(helpTopic.title), 1],
    ['昨天还没答对的词语', (w) => yesterdayWords.includes(w.word), 1],
  ]) {
    const available = all.filter(test);
    if (available.length)
      missions.push({ label, test, count: Math.min(wanted, available.length), found: [] });
  }
  if (!missions.length)
    missions.push({
      label: `含有“${ctx.item.character}”的词语`,
      test: (w) => w.word.includes(ctx.item.character),
      count: 1,
      found: [],
    });
  let active = 0;
  let shown = [];
  function availableWords() {
    // Keep the selected mission's choices at the start of the tray. This is
    // especially important for a time-specific weak-word mission.
    return unique(
      [
        ...all.filter(missions[active].test).slice(0, 6),
        ...missions.flatMap((m) => all.filter(m.test).slice(0, 6)),
        ...all.slice(0, 6),
      ],
      (w) => w.word,
    ).slice(0, 24);
  }
  function draw() {
    const done = missions.every((m) => m.found.length >= m.count);
    shown = availableWords();
    root.innerHTML = `<h2>今日词语寻宝任务</h2><p class="question-instruction">先选任务，再从词语里挑选。找到的词语会放进作文词语袋。</p><div class="stack">${missions.map((m, i) => `<button class="btn ${active === i ? 'primary' : ''}" data-mission="${i}">${m.found.length >= m.count ? '✓' : '○'} 找 ${m.count} 个${e(m.label)} · ${m.found.length}/${m.count}</button>`).join('')}</div><div class="tile-bank">${shown.map((w, i) => `<button class="word-chip" data-treasure="${i}">${e(w.word)}</button>`).join('')}</div><div class="collection"><strong>🎒 我的宝物</strong><p>${
      unique(
        missions.flatMap((m) => m.found),
        (w) => w.word,
      )
        .map((w) => e(w.word))
        .join(' · ') || '找到词语后，就会出现在这里。'
    }</p></div>${done ? `<label for="treasure-paragraph">用找到的2–3个词语，写一个小段落。</label><textarea id="treasure-paragraph" placeholder="想一个能自然用到这些词语的故事。">${e(paragraphDraft)}</textarea><button class="btn primary" id="finish-treasure">记录寻宝与写作</button>` : ''}<p class="source-label">任务只使用当前年级、课次里可找到的词语。没有昨天的错词时，不设错词任务。</p>`;
  }
  draw();
  root.addEventListener(
    'input',
    (event) => {
      if (event.target.id === 'treasure-paragraph') {
        paragraphDraft = event.target.value;
        state.drafts[draftKey] = {
          text: paragraphDraft,
          kind: 'paragraph',
          title: '词语寻宝',
          targetIds: missions.flatMap((m) => m.found).map((w) => w.id),
          at: new Date().toISOString(),
        };
        persist();
      }
    },
    { signal: ctx.signal },
  );
  root.addEventListener(
    'click',
    (event) => {
      if (ctx.finished) return;
      const m = event.target.closest('[data-mission]'),
        b = event.target.closest('[data-treasure]');
      if (m) {
        active = Number(m.dataset.mission);
        draw();
      }
      if (b) {
        const word = shown[Number(b.dataset.treasure)],
          mission = missions[active];
        if (mission.test(word)) {
          if (
            !mission.found.some((w) => w.word === word.word) &&
            mission.found.length < mission.count
          ) {
            mission.found.push(word);
            addTray(word.id);
            const next = missions.findIndex((m) => m.found.length < m.count);
            if (next >= 0) active = next;
          }
          draw();
        } else ctx.note('这个词不属于当前任务。看看参考句，再挑一挑。');
      }
      const textarea = root.querySelector('#treasure-paragraph');
      if (textarea) textarea.value = paragraphDraft;
      if (event.target.closest('#finish-treasure')) {
        const text = textarea.value,
          bag = unique(
            missions.flatMap((m) => m.found),
            (w) => w.word,
          ),
          r = checkWriting(
            text,
            bag.map((w) => w.word),
          );
        if (r.count < 20 || r.used.length < Math.min(2, bag.length) || !/[。！？!?]/.test(text)) {
          ctx.note('试着用袋里至少两个词（词少时用一个），写20字以上的小段落，并加上标点。');
          return;
        }
        state.drafts[draftKey] = {
          text,
          kind: 'paragraph',
          title: '词语寻宝',
          targetIds: bag.map((w) => w.id),
          at: new Date().toISOString(),
        };
        persist();
        ctx.complete({
          kind: 'paragraph',
          items: bag.filter((w) => productionEligible(text, w.word, 20)),
          answer: text,
          message: '寻宝段落已保存。词语已经变成你故事的一部分，请老师一起看看用法吧。',
        });
      }
    },
    { signal: ctx.signal },
  );
}
