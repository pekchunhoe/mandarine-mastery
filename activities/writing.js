import { vocabularyService } from '../js/vocabulary-service.js';
import { escapeHTML as e, highlight, unique, normalize, download } from '../js/utils.js';
import { state, persist, vocabulary } from '../js/state.js';
import { practiceExample } from '../data/content.js';
import { essayCategories, essayTopics, topicMatchesCategory, topicsForGrade } from '../js/essay-title-service.js';
import { getActiveEssayContentsByEssayId } from '../js/essay-content-service.js';
import { splitChineseSentences, splitEssayParagraphs } from '../js/essay-sentence-service.js';
import { enhanceSpeechUI, stop } from '../js/speech-service.js';
import { recommendEssayVocabulary } from '../js/essay-vocabulary-service.js';
import { checkWriting, productionEligible } from '../js/writing-checks.js';
import { enableDrag } from '../components/drag.js';

const planFields = [
  ['time', '时间', '什么时候？'],
  ['place', '地点', '在哪里？'],
  ['who', '人物', '有哪些人？'],
  ['start', '起因', '发生了什么事？'],
  ['action', '经过', '你做了什么？遇到什么转折？'],
  ['result', '结果', '后来怎样了？'],
  ['feeling', '感受', '你有什么感受或收获？'],
];
const modelEssayHTML = (content) => splitEssayParagraphs(content)
  .map((paragraph) => `<p class="model-essay-text">${splitChineseSentences(paragraph).map((sentence) => `<span class="essay-sentence" data-essay-sentence>${e(sentence)}</span>`).join('')}</p>`)
  .join('');
export function writingTargets(ctx, theme, grade, options = {}) {
  const centralRecommendations = recommendEssayVocabulary(theme, grade, options);
  const inLibrary = (id) => vocabularyService.getWordById(id);
  const preferred = [...state.tray.map(inLibrary), ...(ctx.focusWords || [])].filter(Boolean);
  return unique([...preferred, ...centralRecommendations], (word) => word.word).slice(0, 32);
}
export function writing(root, ctx) {
  if (ctx.activity.id === 'story') {
    storyWriting(root, ctx);
    return;
  }
  let topicGrade = Math.max(1, Math.min(6, Number(state.settings.grade) || 3));
  let topicCategory = '全部', topicSearch = '', vocabularyFunction = '全部', wordOffset = 0;
  const availableTopics = () => {
    return topicsForGrade(topicGrade).filter(
      (topic) => topicMatchesCategory(topic, topicCategory) && topic.title.includes(topicSearch.trim()),
    );
  };
  let themes = availableTopics();
  let themeIndex =
    state.settings.essayTopic !== 'all'
      ? themes.findIndex((t) => t.title === state.settings.essayTopic)
      : Number(ctx.params.get('theme')) || 0;
  themeIndex = Math.max(0, Math.min(themes.length - 1, themeIndex));
  let theme = themes[themeIndex] || themes[0] || essayTopics[0],
    targets = [],
    draft,
    key;
  let saveTimer;
  const paragraphMode = ctx.activity.id === 'paragraphBuilder',
    plannerMode = ctx.activity.id === 'planner';
  function load() {
    key = `${paragraphMode ? 'paragraph' : 'composition'}:${state.settings.grade}:${state.settings.lesson}:${themeIndex < 4 ? themeIndex : encodeURIComponent(theme.title)}`;
    draft = state.drafts[key] || {
      text: '',
      plan: {},
      order: planFields.map((x) => x[0]),
      checklist: {},
      kind: paragraphMode ? 'paragraph' : 'essay',
      title: theme.title,
    };
    draft.plan ||= {};
    draft.checklist ||= {};
    draft.order = unique([...(draft.order || []), ...planFields.map((x) => x[0])]).filter((k) =>
      planFields.some((f) => f[0] === k),
    );
    targets = writingTargets(ctx, theme, topicGrade, { function: vocabularyFunction });

    draft.targetIds = targets.map((w) => w.id);
    draft.selectedWordIds ||= [];
  }
  function save() {
    draft.at = new Date().toISOString();
    draft.grade = state.settings.grade;
    draft.lesson = state.settings.lesson;
    draft.title = theme.title;
    state.drafts[key] = draft;
    const ok = persist();
    const status = root.querySelector('#draft-status');
    if (status) status.textContent = ok ? '✓ 草稿已保存到这台设备' : '未能保存，请导出草稿';
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; save(); }, 400);
  }
  const planCard = (id) => {
    const field = planFields.find((f) => f[0] === id);
    return `<section class="plan-card" data-drop="plan-${id}"><div class="row between"><label for="plan-${id}">${field[1]} · ${field[2]}</label><div class="row"><button class="plan-order" data-plan-up="${id}" aria-label="上移${field[1]}">↑</button><button class="plan-order tile" data-drag="plan-${id}" aria-label="拖动${field[1]}">⠿</button></div></div><textarea id="plan-${id}" data-plan="${id}" placeholder="先记下几个关键词……">${e(draft.plan[id] || '')}</textarea></section>`;
  };
  function draw() {
    stop();
    const visibleWords = targets.slice(wordOffset, wordOffset + 8);
    const selectedWords = draft.selectedWordIds.map((id) => vocabularyService.getWordById(id)).filter(Boolean);
    const modelEssays = getActiveEssayContentsByEssayId(theme.id);
    const modelEssayPanel = modelEssays.length
      ? `<details class="reference-details model-essay-reference"><summary>范文参考（${modelEssays.length}篇）</summary><p class="small muted">先自己构思；需要时再展开范文，比较写法和用词。</p>${modelEssays.map((essay) => `<article class="writing-preview"><div class="row between"><strong>${e(essay.contentTitle || `范文 ${essay.version}`)}</strong><span class="small muted">${e(essay.level)} · ${essay.wordCount}字</span></div>${modelEssayHTML(essay.content)}</article>`).join('')}</details>`
      : '';
    root.innerHTML = `<h2>${paragraphMode ? '把想法变成一段话' : ctx.activity.id === 'assistant' ? '读一读，让作文更清楚' : plannerMode ? '先画一张故事地图' : '小小作文挑战'}</h2><section class="essay-topic-picker panel soft"><div class="row between"><strong>选择作文题目</strong><span class="small muted">${themes.length} 个题目</span></div><div class="essay-topic-controls"><label>年级<select id="essay-topic-grade">${[1,2,3,4,5,6].map((grade) => `<option value="${grade}" ${grade === topicGrade ? 'selected' : ''}>${['一','二','三','四','五','六'][grade - 1]}年级</option>`).join('')}</select></label><label class="topic-search">搜索作文题目<input id="essay-topic-search" type="search" value="${e(topicSearch)}" placeholder="搜索作文题目"></label></div><div class="topic-filter-row" aria-label="题目类别">${essayCategories.map((category) => `<button class="topic-filter ${category === topicCategory ? 'active' : ''}" data-topic-category="${e(category)}">${e(category)}</button>`).join('')}</div><label for="writing-theme">我想写的题目</label><select id="writing-theme">${themes.map((t, i) => `<option value="${i}" ${t.id === theme.id ? 'selected' : ''}>《${e(t.title)}》</option>`).join('')}</select></section><p class="question-instruction">${paragraphMode ? '试着写一个40–80字的小段落。' : '试着写一个80–120字的小故事。'}选用适合的词语，不必全部用上。</p><div class="panel soft essay-word-pocket"><div class="row between"><strong class="small">我的作文词语袋</strong><span class="small muted">${Math.min(wordOffset + 8, targets.length)} / ${targets.length} · 点词看用法</span></div><div class="topic-filter-row" aria-label="词语功能">${['全部','动作','心情','经过','转折','结果','感受'].map((name) => `<button class="topic-filter ${name === vocabularyFunction ? 'active' : ''}" data-word-function="${name}">${name}</button>`).join('')}</div><div class="word-pocket-grid" id="writing-targets">${visibleWords.map((w) => `<div class="word-pocket-item"><button class="word-chip tile" data-word-card="${e(w.id)}" data-drag="word-${e(w.id)}">${e(w.word)}</button><button class="word-add" data-select-word="${e(w.id)}" aria-label="加入作文词语 ${e(w.word)}">＋</button></div>`).join('')}</div><button class="btn quiet word-next" id="change-word-group" ${targets.length <= 8 ? 'disabled' : ''}>换一组</button>${selectedWords.length ? `<div class="selected-words"><strong class="small">已选词语</strong>${selectedWords.map((w) => `<button class="selected-word" data-remove-word="${e(w.id)}">${e(w.word)} ×</button>`).join('')}</div>` : ''}</div><details class="reference-details" id="planner-details" ${plannerMode || paragraphMode || !draft.text ? 'open' : ''}><summary>故事计划 · 时间 → 地点 → 人物 → 起因 → 经过 → 结果 → 感受</summary><p class="small muted">可以拖动卡片，也可以用 ↑ 调整计划顺序。只写对故事有帮助的内容。</p><div class="plan-grid">${draft.order.map(planCard).join('')}</div><div class="action-bar"><button class="btn primary" id="start-writing">开始写${paragraphMode ? '段落' : '作文'}</button><button class="btn" id="plan-to-draft">把计划复制为草稿</button></div></details><label for="essay-text">${paragraphMode ? '我的段落' : '我的作文'}</label><textarea class="writing-editor" id="essay-text" placeholder="把你经历或想象的故事写在这里。记得分句，加上标点。">${e(draft.text)}</textarea><div class="row between"><div id="writing-metrics" class="writing-metrics"></div><span class="save-status" id="draft-status">草稿保存在这台设备</span></div><details class="reference-details"><summary>看看用到的词语</summary><div class="writing-preview" id="writing-preview"></div></details><div class="action-bar"><button class="btn primary" id="check-writing">自动检查</button><button class="btn" id="export-writing">导出作文</button></div><div id="writing-report" class="notice" hidden aria-live="polite"></div><div class="self-assess"><h3>我自己读一读</h3>${[
      ['opening', '开头交代了人物或事情。'],
      ['body', '经过写清楚了，有合适的标点。'],
      ['ending', '写出了结果或自己的感受。'],
      ['natural', '词语用得自然，没有为了凑词而硬写。'],
    ]
      .map(
        ([k, label]) =>
          `<div class="check-row"><input type="checkbox" id="check-${k}" data-checklist="${k}" ${draft.checklist[k] ? 'checked' : ''}><label for="check-${k}">${label}</label></div>`,
      )
      .join(
        '',
      )}</div><button class="btn primary" id="finish-writing">保存并完成这次练习</button><p class="source-label">自动检查只统计字数、分段、标点和词语出现情况。内容、语法与用词是否自然，请和老师一起检查。</p>`;
    if (modelEssayPanel) root.querySelector('.question-instruction').insertAdjacentHTML('afterend', modelEssayPanel);
    update();
    enhanceSpeechUI(root);
  }
  function update() {
    const report = checkWriting(
      draft.text,
      targets.map((w) => w.word),
      draft.plan,
    );
    root.querySelector('#writing-metrics').innerHTML =
      `<span><strong>${report.count}</strong> 字</span><span>${report.paragraphs} 段</span><span>${report.used.length} / ${targets.length} 个建议词语</span>`;
    root.querySelector('#writing-preview').innerHTML = highlight(
      draft.text,
      targets.map((w) => w.word),
    );
    root.querySelectorAll('#writing-targets [data-word-card]').forEach((b) => {
      const w = targets.find((w) => w.id === b.dataset.wordCard);
      const used = report.used.includes(w.word);
      b.classList.toggle('used-word', used);
      b.innerHTML = `${used ? '✓ ' : ''}${e(w.word)}`;
    });
    return report;
  }
  function compactPlanner() {
    if (!plannerMode && !paragraphMode) root.querySelector('#planner-details').open = false;
  }
  function refreshTopicList() {
    themes = availableTopics();
    if (!themes.some((topic) => topic.id === theme.id)) theme = themes[0] || essayTopics[0];
    themeIndex = themes.findIndex((topic) => topic.id === theme.id);
    wordOffset = 0;
    load();
    draw();
    compactPlanner();
  }
  load();
  draw();
  compactPlanner();
  ctx.signal?.addEventListener('abort', () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; save(); }
  }, { once: true });
  enableDrag(
    root,
    (id, to) => {
      if (!to.startsWith('plan-')) return;
      const field = to.slice(5);
      if (id.startsWith('word-')) {
        const word = vocabulary.find((w) => w.id === id.slice(5));
        if (word) {
          draft.plan[field] = [draft.plan[field], word.word].filter(Boolean).join('、');
          save();
          draw();
        }
      } else if (id.startsWith('plan-')) {
        const moved = id.slice(5);
        draft.order = draft.order.filter((x) => x !== moved);
        draft.order.splice(draft.order.indexOf(field), 0, moved);
        save();
        draw();
      }
    },
    ctx.signal,
  );
  root.addEventListener(
    'input',
    (event) => {
      if (event.target.id === 'essay-text') {
        draft.text = event.target.value;
        draft.reviewedAt = null;
        update();
        scheduleSave();
      }
      if (event.target.dataset.plan) {
        draft.plan[event.target.dataset.plan] = event.target.value;
        scheduleSave();
      }
      if (event.target.id === 'essay-topic-search') {
        topicSearch = event.target.value;
        refreshTopicList();
      }
    },
    { signal: ctx.signal },
  );
  root.addEventListener(
    'change',
    (event) => {
      if (event.target.id === 'writing-theme') {
        save();
        themeIndex = Number(event.target.value);
        theme = themes[themeIndex];
        state.settings.essayTopic = theme.title;
        wordOffset = 0;
        load();
        draw();
        compactPlanner();
      }
      if (event.target.id === 'essay-topic-grade') {
        topicGrade = Number(event.target.value);
        refreshTopicList();
      }
      if (event.target.dataset.checklist) {
        draft.checklist[event.target.dataset.checklist] = event.target.checked;
        save();
      }
    },
    { signal: ctx.signal },
  );
  root.addEventListener(
    'click',
    (event) => {
      const b = event.target.closest('button');
      if (!b) return;
      if (b.dataset.planUp) {
        const index = draft.order.indexOf(b.dataset.planUp);
        if (index > 0) {
          [draft.order[index - 1], draft.order[index]] = [
            draft.order[index],
            draft.order[index - 1],
          ];
          save();
          draw();
        }
        return;
      }
      if (b.dataset.topicCategory) {
        topicCategory = b.dataset.topicCategory;
        refreshTopicList();
        return;
      }
      if (b.dataset.wordFunction) {
        vocabularyFunction = b.dataset.wordFunction;
        wordOffset = 0;
        load();
        draw();
        compactPlanner();
        return;
      }
      if (b.id === 'change-word-group') {
        wordOffset = wordOffset + 8 >= targets.length ? 0 : wordOffset + 8;
        draw();
        compactPlanner();
        return;
      }
      if (b.dataset.selectWord) {
        draft.selectedWordIds = unique([...draft.selectedWordIds, b.dataset.selectWord]).slice(-12);
        save();
        draw();
        compactPlanner();
        return;
      }
      if (b.dataset.removeWord) {
        draft.selectedWordIds = draft.selectedWordIds.filter((id) => id !== b.dataset.removeWord);
        save();
        draw();
        compactPlanner();
        return;
      }
      if (b.id === 'start-writing') {
        root.querySelector('#planner-details').open = false;
        root.querySelector('#plan-outline')?.remove();
        const notes = draft.order
          .filter((k) => draft.plan[k]?.trim())
          .map(
            (k) =>
              `<p class="small no-margin"><strong>${planFields.find((f) => f[0] === k)[1]}：</strong>${e(draft.plan[k])}</p>`,
          )
          .join('');
        if (notes)
          root
            .querySelector('#planner-details')
            .insertAdjacentHTML(
              'afterend',
              `<div class="notice" id="plan-outline"><strong>写作时看看我的计划</strong>${notes}</div>`,
            );
        root.querySelector('#essay-text').focus();
        root.querySelector('#essay-text').scrollIntoView({ block: 'center', behavior: 'auto' });
      }
      if (b.id === 'plan-to-draft') {
        if (draft.text.trim()) {
          ctx.note('已有作文草稿。请手动选用计划里的内容，避免覆盖。');
          return;
        }
        draft.text = draft.order
          .map((k) => draft.plan[k]?.trim())
          .filter(Boolean)
          .join('\n');
        save();
        draw();
      }
      if (b.id === 'check-writing') {
        const r = update(),
          el = root.querySelector('#writing-report');
        el.hidden = false;
        el.innerHTML = `<strong>自动检查</strong>${r.messages.map((m) => `<p>${e(m)}</p>`).join('')}<p>计划已填写 ${r.planCount} / 7 项。开头、经过和结尾是否完整，请自己读一读。</p>`;
        save();
      }
      if (b.id === 'export-writing') {
        download(
          `${theme.title}.txt`,
          `${theme.title}\n\n${draft.text}\n\n我的计划\n${draft.order.map((k) => `${planFields.find((f) => f[0] === k)[1]}：${draft.plan[k] || ''}`).join('\n')}`,
        );
      }
      if (b.id === 'finish-writing' && !ctx.finished) {
        const r = update();
        save();
        if (r.count < 20) {
          ctx.note('草稿已经保存。再写清楚事情的经过和结果，至少写20个汉字后记录段落练习。');
          return;
        }
        if (!draft.checklist.natural) {
          ctx.note('先读一遍，勾选最后一项“词语用得自然”。');
          return;
        }
        const used = targets.filter(
          (w) =>
            productionEligible(draft.text, w.word, 20) &&
            normalize(draft.text) !== normalize(practiceExample(w)),
        );
        ctx.complete({
          kind: 'paragraph',
          items: used,
          answer: draft.text,
          message: `作文已保存，你用了${r.used.length}个建议词语。已记录写作练习；内容与用词等待老师一起检查。${r.count < 80 && !paragraphMode ? '你也可以继续补充到建议的80–120字。' : ''}`,
        });
      }
    },
    { signal: ctx.signal },
  );
}
function storyWriting(root, ctx) {
  const key = `story:${state.settings.grade}:${state.settings.lesson}`;
  let draft = state.drafts[key] || { text: '', lines: [], kind: 'essay', title: '校门口的书包' };
  draft.lines ||= [];
  const targets = unique([...(ctx.focusWords || []), ...ctx.pool], (w) => w.word).slice(0, 12);
  let offset = 0;
  let saveTimer;
  const opening = '放学后，我在校门口发现一个没人认领的书包……';
  const current = () => targets[(draft.lines.length + offset) % targets.length];
  function draw() {
    root.innerHTML = `<h2>一句接一句，故事由你继续</h2><p class="story-line">${opening}</p>${draft.lines.map((line, i) => `<p class="story-line">${i + 1}. ${e(line)}</p>`).join('')}<p class="small muted">已经续写 ${draft.lines.length} 句 · 目标 4–6 句</p>${draft.lines.length < 6 ? `<div class="row"><span class="pill">试着用：${e(current().word)}</span><button class="btn quiet" id="change-story-word">这个词不适合，换一个</button></div><label for="next-story">接下来发生了什么？</label><textarea id="next-story">${e(draft.pending || '')}</textarea><button class="btn primary" id="append-story">接上这一句</button>` : ''}<div class="action-bar"><button class="btn" id="finish-story" ${draft.lines.length < 4 ? 'disabled' : ''}>完成我的小故事</button><button class="btn" id="export-story">导出故事</button></div><p class="source-label">词语只是建议。故事要前后连贯，完成后读给老师听听。</p>`;
  }
  function save() {
    draft.text = [opening, ...draft.lines].join('\n');
    draft.at = new Date().toISOString();
    draft.targetIds = targets.map((w) => w.id);
    state.drafts[key] = draft;
    persist();
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; save(); }, 400);
  }
  draw();
  ctx.signal?.addEventListener('abort', () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; save(); }
  }, { once: true });
  root.addEventListener(
    'input',
    (event) => {
      if (event.target.id === 'next-story') {
        draft.pending = event.target.value;
        scheduleSave();
      }
    },
    { signal: ctx.signal },
  );
  root.addEventListener(
    'click',
    (event) => {
      const b = event.target.closest('button');
      if (!b || ctx.finished) return;
      if (b.id === 'change-story-word') {
        offset++;
        draw();
      }
      if (b.id === 'append-story') {
        const text = root.querySelector('#next-story').value.trim();
        if (normalize(text).length < 6 || !/[。！？!?]/.test(text)) {
          ctx.note('写清楚一件事，再加上句末标点。');
          return;
        }
        draft.lines.push(text);
        draft.pending = '';
        save();
        draw();
      }
      if (b.id === 'export-story') download('我的故事接龙.txt', draft.text);
      if (b.id === 'finish-story' && draft.lines.length >= 4) {
        save();
        ctx.complete({
          kind: 'paragraph',
          items: targets.filter((w) => productionEligible(draft.lines.join(''), w.word, 20)),
          answer: draft.lines.join(''),
          message: '故事已经保存！读一读前后是否连贯，再请老师看看用词。',
        });
      }
    },
    { signal: ctx.signal },
  );
}
