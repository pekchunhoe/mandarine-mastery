import {
  state,
  vocabulary,
  filteredWords,
  weakWords,
  persist,
  setSettings,
  resetProgress,
  replaceState,
  attempt,
} from './state.js';
import { aggregate, stage, reviewQueue, streak } from './mastery.js';
import {
  escapeHTML as e,
  highlight,
  unique,
  dayKey,
  prettyGrade,
  download,
  toast,
  $,
  $$,
} from './utils.js';
import { activities, stages } from '../data/activities.js';
import { practiceExample, editorial } from '../data/content.js';
import { gardenArt } from '../components/garden.js';
import { confirmAction, showModal, closeModal } from '../components/modal.js';
import { hydrate } from './storage.js';
import { productionEligible } from './writing-checks.js';
import { vocabularyService } from './vocabulary-service.js';
import { vocabularyDetails } from '../components/vocabulary-details.js';
import { backButton } from './navigation.js';

function goHome() {
  location.hash = 'home';
  // Render the cleared/restored state immediately. The browser will later
  // emit its native hashchange too, which is harmless and keeps back/forward
  // navigation on the same router path.
  window.dispatchEvent(new Event('hashchange'));
}

export function filters() {
  const lessons = unique(
    vocabulary
      .filter((w) => state.settings.grade === 'mixed' || String(w.grade) === state.settings.grade)
      .map((w) => w.lesson)
      .filter(Boolean),
  ).sort((a, b) => Number(a) - Number(b));
  const select = (setting, label, values) =>
    `<label>${label}<select data-setting="${setting}" aria-label="${label}"><option value="all">全部</option>${values.map((v) => `<option value="${e(v)}" ${state.settings[setting] === v ? 'selected' : ''}>${e(v)}</option>`).join('')}</select></label>`;
  return `<div class="filter-bar"><label>学习年级<select data-setting="grade" aria-label="学习年级"><option value="mixed" ${state.settings.grade === 'mixed' ? 'selected' : ''}>混合复习</option>${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${state.settings.grade === String(n) ? 'selected' : ''}>${prettyGrade(n)}</option>`).join('')}</select></label><label>课次<select data-setting="lesson" aria-label="课次" ${!lessons.length ? 'disabled' : ''}><option value="all">${lessons.length ? '全部课次' : '全部词语（未分课）'}</option>${lessons.map((n) => `<option value="${e(n)}" ${state.settings.lesson === n ? 'selected' : ''}>第${e(n)}课</option>`).join('')}</select></label><details class="advanced-filters" ${['category', 'wordDifficulty', 'tag', 'essayTopic'].some((k) => state.settings[k] && state.settings[k] !== 'all') ? 'open' : ''}><summary>更多词语筛选</summary><div class="library-controls">${select('category', '类别', vocabularyService.values('category'))}${select('wordDifficulty', '词语难度', ['1', '2', '3'])}${select('tag', '标签', vocabularyService.values('tags'))}${select('essayTopic', '作文主题', vocabularyService.values('essayTopics'))}</div><button type="button" class="btn" data-clear-vocabulary-filters>清除更多筛选</button></details></div>`;
}
export const heading = (title, subtitle = '', withFilters = true) =>
  `<div class="page-back-bar">${backButton()}</div><div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${withFilters ? filters() : ''}</div>`;
const activityCard = (a) =>
  `<a class="activity-card" href="#activity/${a.id}"><div class="row between"><span class="activity-icon">${a.icon}</span>${a.core ? '<span class="pill peach">用词进阶</span>' : `<span class="pill">${stages[a.stage]}</span>`}</div><h3>${a.name}</h3><p>${a.desc}</p><div class="card-foot"><span>约 ${a.minutes} 分钟 · ${stages[a.stage]}练习</span><span class="card-arrow" aria-hidden="true">↗</span></div></a>`;
const progress = (value, max = 100) =>
  `<div class="progress-track" role="progressbar" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="${max}"><div class="progress-fill" style="width:${Math.min(100, (value / Math.max(1, max)) * 100)}%"></div></div>`;
export function metrics() {
  const items = unique(filteredWords(), (w) => w.word),
    words = new Set(items.map((w) => w.word));
  const records = items.map((w) => aggregate(state, w.word));
  const today = state.history.filter(
    (h) => h.at && dayKey(new Date(h.at)) === dayKey() && words.has(h.word),
  );
  const rec = records.reduce((n, r) => n + r.recognition, 0),
    errors = state.history.filter(
      (h) => h.kind === 'recognition' && !h.correct && words.has(h.word),
    ).length;
  return {
    items,
    records,
    today: unique(today, (h) => h.word).length,
    mastered: records.filter((r) => r.mastery >= 90).length,
    sentence: records.reduce((n, r) => n + r.sentenceSuccess, 0),
    paragraph: records.filter((r) => r.paragraphSuccess).length,
    accuracy: rec + errors ? Math.round((rec / (rec + errors)) * 100) : null,
    seen: records.filter((r) => r.seen).length,
    due: records.filter((r) => r.due && new Date(r.due) <= new Date()).length,
    weekly: items.filter((w) => {
      const r = aggregate(state, w.word);
      return (
        r.mastery >= 90 &&
        state.history.some(
          (h) =>
            h.word === w.word &&
            h.kind === 'reviewed' &&
            new Date(h.at) > new Date(Date.now() - 7 * 86400000),
        )
      );
    }).length,
  };
}
export function home(root) {
  const m = metrics(),
    count = filteredWords().length;
  root.innerHTML = `${heading('今天，让词语长成故事。', '从认词、造句到作文，一步一步学会用词。')}<div class="dashboard-grid"><section class="hero"><div class="hero-copy"><span class="eyebrow">MY WORD GARDEN · 我的词语花园</span><h2>认识一个词，<br>写出<em>自己的故事。</em></h2><p>每天一点点，从“我认识”走向“我会用”。<br>今天的词语，等你来发现。</p><div class="hero-actions"><a class="btn primary" href="#activity/recognition?daily=1">▷ 开始今日10分钟</a><a class="btn" href="#activities">自由练习 ↗</a></div><div class="hero-footer"><span>◷ 按自己的节奏学习</span><span>✳ 进度自动保存</span></div></div>${gardenArt}</section><div class="side-stack"><section class="panel"><div class="row between"><h3>今天的小目标</h3><span class="pill gold">每天 5 词</span></div><div class="row"><div class="day-ring" style="--progress:${Math.min(100, (m.today / 5) * 100)}%"><span>${m.today}/5</span></div><div><strong>${m.today >= 5 ? '目标完成啦！' : '让词语再熟悉一点'}</strong><p class="small muted no-margin">学词，也练习怎样用词。</p></div></div><div class="progress-label"><span>今日学习</span><span>${Math.min(100, Math.round((m.today / 5) * 100))}%</span></div>${progress(m.today, 5)}</section><section class="panel peach"><div class="row between"><h3>记得回来看看它们</h3><span>🌱</span></div><p class="small muted">${m.due ? `${m.due} 个词语到了复习时间。` : '先认识几个词，花园就开始成长。'}练过的词语，会在这里等你。</p><a class="btn full" href="#review">${m.due ? '开始复习' : '看看今日复习'} →</a></section></div></div><div class="stats-grid">${[
    ['今日学习', m.today, '个不同词语', '✳'],
    ['会使用的词语', m.records.filter((r) => r.mastery >= 65).length, '从认得走向用得出', '🌿'],
    ['自主造句', m.sentence, '次已记录练习', '✎'],
    ['连续学习', streak(state.days), '天 · 按自己的节奏', '☀'],
  ]
    .map(
      ([label, value, note, icon]) =>
        `<div class="stat-card"><div class="stat-top"><span class="label">${label}</span><span class="stat-icon">${icon}</span></div><span class="number">${value}<small> ${label === '连续学习' ? '天' : ''}</small></span><span class="note">${note}</span></div>`,
    )
    .join(
      '',
    )}</div><div class="section-heading"><h2>我的学习路线</h2><a href="#activities">从任意一站开始 →</a></div><div class="journey">${stages.map((s, i) => `<a class="journey-stop ${i === 0 ? 'active' : ''}" href="#activities?stage=${i}"><span class="step-no">0${i + 1}</span>${s} ${i === 6 ? '✎' : '→'}</a>`).join('')}</div><div class="section-heading"><h2>让词语真正用起来</h2><a href="#activities">全部 ${activities.length} 项练习 →</a></div><div class="activity-grid">${activities
    .filter((a) => a.core)
    .map(activityCard)
    .join(
      '',
    )}</div><p class="footer-note">${prettyGrade(state.settings.grade)} · 当前 ${count} 条词语来源 · 全库 ${vocabulary.length} 条 · 学习记录仅保存在这台设备</p>`;
}
export function activityList(root, params) {
  const selected = params.get('stage');
  root.innerHTML = `${heading('自由练习', '选一项练习，让学过的词语用起来。')}<div class="stage-tabs"><a class="toggle ${selected === null ? 'active' : ''}" href="#activities">全部练习</a>${stages.map((s, i) => `<a class="toggle ${selected === String(i) ? 'active' : ''}" href="#activities?stage=${i}">${s}</a>`).join('')}</div><div class="activity-grid">${activities
    .filter((a) => selected === null || String(a.stage) === selected)
    .map(activityCard)
    .join('')}</div>`;
}
function wordCard(w, weak = false) {
  const r = aggregate(state, w.word);
  return `<article class="word-card"><div class="row between"><button class="word-title" data-word-card="${e(w.id)}">${e(w.word)}</button><span class="pill">${stage(r.mastery)}</span></div><p class="source-label">${prettyGrade(w.grade)} · 生字 ${e(w.character)}${w.lesson ? ` · 第${e(w.lesson)}课` : ''}</p>${vocabularyDetails(w)}${progress(r.mastery)}<div class="progress-label"><span>正确 ${r.correct} 次 · 失误 ${r.incorrect} 次</span><span>${r.mastery}%</span></div>${weak && r.lastError ? `<p class="small muted">最近错误：${e(r.lastError.message)}<br>${e(new Date(r.lastError.at).toLocaleDateString('zh-CN'))}</p>` : ''}<div class="row"><a class="btn" href="#activity/cloze?word=${encodeURIComponent(w.id)}">再练一次</a><a class="btn" href="#activity/builder?word=${encodeURIComponent(w.id)}&mode=free">造句</a><button class="icon-btn" data-tray="${e(w.id)}" aria-label="把${e(w.word)}加入作文">＋</button></div></article>`;
}
export function library(root, mode = 'library') {
  const weak = mode === 'weak',
    review = mode === 'review';
  const source = weak
    ? weakWords()
    : review
      ? reviewQueue(filteredWords(), state, 20)
      : filteredWords();
  root.innerHTML = `${heading(weak ? '我的弱词' : review ? '今日复习' : '词语库', weak ? '每一次“还不会”，都是下一次进步的起点。' : review ? '优先练习最近答错、需要巩固和到期的词语。' : '从中央词库学习，点开看看词语怎样用。')} <p><a class="btn" href="#vocabulary-admin">老师：管理词库</a></p>${review ? '<div class="notice row between"><span>复习后，试着把这些词写进一句话。</span><a class="btn primary" href="#activity/cloze?review=1">开始复习 →</a></div>' : ''}<div class="library-tools"><input id="word-search" type="search" placeholder="搜索词语、近义词或中文释义……" aria-label="搜索词语"><button class="btn" id="favorites-only" aria-pressed="false">☆ 我的收藏</button><span id="word-count" class="pill"></span></div><div id="word-grid" class="library-grid"></div><div id="word-pages"></div>`;
  let page = 0,
    favorites = false,
    query = '';
  const size = 18;
  root
    .querySelector('.library-tools')
    .insertAdjacentHTML(
      'afterend',
      '<div class="stage-tabs"><a class="toggle" href="#library">全部词语</a><a class="toggle" href="#weak">⭐ 我的弱词</a><a class="toggle" href="#review">↻ 今日复习</a></div>',
    );
  function draw() {
    const words = vocabularyService.searchWords(query, { pool: source }).filter(
      (w) => !favorites || state.favorites.includes(w.id),
    );
    const pages = Math.max(1, Math.ceil(words.length / size));
    page = Math.min(page, pages - 1);
    $('#word-count', root).textContent = `${words.length} 条词语来源`;
    $('#word-grid', root).innerHTML = words.length
      ? words
          .slice(page * size, (page + 1) * size)
          .map((w) => wordCard(w, weak))
          .join('')
      : `<div class="empty-state"><span class="empty-icon">🌱</span><h2>${weak ? '暂时没有需要加强的词语' : favorites ? '还没有收藏词语' : '没有找到符合条件的词语'}</h2><p class="muted">${weak ? '练习中遇到的困难会自动记在这里。' : '找不到相关词语，请尝试其他关键词、近义词或释义。也可以调整年级或课次。'}</p><a class="btn primary" href="#activities">去练一练</a></div>`;
    $('#word-pages', root).innerHTML =
      words.length > size
        ? `<div class="pagination"><button class="btn" id="prev-page" ${page === 0 ? 'disabled' : ''}>上一页</button><span>${page + 1} / ${pages}</span><button class="btn" id="next-page" ${page >= pages - 1 ? 'disabled' : ''}>下一页</button></div>`
        : '';
    $('#prev-page', root)?.addEventListener('click', () => {
      page--;
      draw();
    });
    $('#next-page', root)?.addEventListener('click', () => {
      page++;
      draw();
    });
  }
  $('#word-search', root).oninput = (event) => {
    query = event.target.value.trim();
    page = 0;
    draw();
  };
  $('#favorites-only', root).onclick = (event) => {
    favorites = !favorites;
    event.currentTarget.setAttribute('aria-pressed', String(favorites));
    event.currentTarget.classList.toggle('primary', favorites);
    page = 0;
    draw();
  };
  draw();
}
export function stats(root) {
  const m = metrics();
  root.innerHTML = `${heading('我的成长记录', '认识、记得、会使用，每一步都值得看见。')}<div class="stats-grid">${[
    ['认词准确率', m.accuracy === null ? '—' : `${m.accuracy}%`],
    ['本周新掌握', m.weekly],
    ['作文练过的词', m.paragraph],
    ['到期复习', m.due],
  ]
    .map(
      ([label, n]) =>
        `<div class="stat-card"><span class="label">${label}</span><span class="number">${n}</span></div>`,
    )
    .join(
      '',
    )}</div><div class="settings-grid" style="margin-top:24px"><section class="panel"><h2>从认识到使用</h2>${[
    ['🌱 初识', (r) => r.mastery < 25],
    ['🌿 学习中', (r) => r.mastery >= 25 && r.mastery < 65],
    ['⭐ 会使用', (r) => r.mastery >= 65 && r.mastery < 90],
    ['🏆 已掌握', (r) => r.mastery >= 90],
  ]
    .map(([s, test]) => {
      const n = m.records.filter(test).length;
      return `<div class="progress-label"><span>${s}</span><span>${n} 词</span></div>${progress(n, m.items.length)}`;
    })
    .join(
      '',
    )}<p class="small muted" style="margin-top:18px">认词只是起点。回忆、自主造句和写作带来更多进步；“已掌握”还需要老师检查过写作中的用法。</p></section><section class="panel"><h2>我的学习徽章</h2>${state.badges.length ? state.badges.map((b) => `<span class="badge">${e(b)}</span>`).join('') : '<p class="muted">每一次认真练习，都在向徽章靠近。</p><span class="badge locked">🌱 初识50词</span><span class="badge locked">🧩 句子建筑师</span><span class="badge locked">✍️ 造句达人</span>'}<hr><p>学习经验 <strong>${state.xp} XP</strong></p><p>连续学习 <strong>${streak(state.days)} 天</strong></p><a class="btn primary" href="#review">继续巩固词语 →</a></section></div><section class="panel" style="margin-top:24px"><h2>最近的练习</h2>${
    state.history.length
      ? state.history
          .slice(-12)
          .reverse()
          .map(
            (h) =>
              `<div class="list-row"><span>${h.correct ? '✓' : '↻'}</span><div class="grow"><strong>${e(h.word)}</strong><small>${{ recognition: '认词', context: '理解语境', recall: '自主回忆', guided: '积木 / 排序', sentence: '自主造句练习', paragraph: '写作练习', reviewed: '老师已检查' }[h.kind] || '练习'} · ${e(new Date(h.at).toLocaleDateString('zh-CN'))}</small></div><span class="pill">${h.correct ? `+${h.xp} XP` : '还要练习'}</span></div>`,
          )
          .join('')
      : '<p class="muted">完成第一项练习后，就能看到记录。</p>'
  }</section>`;
}
export function teacher(root) {
  root.innerHTML = `${heading('老师工具箱', '在这台设备上安排练习、投影教学与检查写作。')}<p><a class="btn primary" href="#vocabulary-admin">管理词语库 · 导入 / 编辑 / 导出</a></p><div class="settings-grid"><section class="panel"><h2>安排一项课堂活动</h2><div class="teacher-grid"><label>活动<select id="teacher-activity">${activities.map((a) => `<option value="${a.id}" ${a.id === 'cloze' ? 'selected' : ''}>${a.name}</option>`).join('')}</select></label><label>词语 / 题目数量<select id="teacher-count">${[3, 5, 10, 15, 20].map((n) => `<option ${n === state.settings.count ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label>难度<select id="teacher-difficulty">${[
    ['easy', '初级 · 更多引导'],
    ['medium', '中级 · 减少选择'],
    ['hard', '挑战 · 输入回忆与造句'],
  ]
    .map(
      ([v, t]) =>
        `<option value="${v}" ${state.settings.difficulty === v ? 'selected' : ''}>${t}</option>`,
    )
    .join(
      '',
    )}</select></label></div><div class="check-row"><input type="checkbox" id="teacher-timed" ${state.settings.timed ? 'checked' : ''}><label for="teacher-timed">启用限时（认词30秒 / 配词60秒 / 填空90秒）</label></div><div class="check-row"><input type="checkbox" id="teacher-hints" ${state.settings.hints ? 'checked' : ''}><label for="teacher-hints">允许使用提示</label></div><button class="btn primary" id="start-teacher">开始课堂活动 →</button></section><section class="panel soft"><h2>投影模式</h2><p class="muted">放大文字和答题控件，方便全班一起练习。</p><button class="btn" id="projection-toggle">${state.settings.projection ? '关闭' : '开启'}投影模式</button><hr><h3>掌握程度怎样计算？</h3><p class="small">认词 +2、语境 +4、回忆 +7、积木 +9、自主造句练习 +14、段落练习 +22。提示稍减经验值。错误记录影响熟练程度。</p><p class="small">客观出现词语不代表用法正确。写作练习的最高自动熟练度为89%；最后一档需要老师检查，还要有回忆和自主造句记录。</p></section></div><section class="panel" style="margin-top:24px"><h2>这台设备上的写作草稿</h2><p class="small muted">检查学生是否在具体、连贯的情境中自然使用词语。只有亲自读过，才确认用法。</p><div id="teacher-drafts"></div></section><details class="panel" style="margin-top:24px"><summary>词表与教学例句说明</summary><p>最初迁移保留564条词语来源。当前本机词库 ${vocabulary.length} 条。以下 ${Object.keys(editorial).length} 个词另有补充例句，原句仍可在词语卡中查看。</p>${Object.entries(
    editorial,
  )
    .map(
      ([word, note]) =>
        `<div class="list-row"><strong>${e(word)}</strong><div><p class="small">${e(note.reason)}</p><p>${e(note.example)}</p></div></div>`,
    )
    .join('')}</details>`;
  $('#start-teacher', root).onclick = () => {
    setSettings({
      difficulty: $('#teacher-difficulty', root).value,
      count: Number($('#teacher-count', root).value),
      timed: $('#teacher-timed', root).checked,
      hints: $('#teacher-hints', root).checked,
    });
    location.hash = `activity/${$('#teacher-activity', root).value}`;
  };
  $('#projection-toggle', root).onclick = () => {
    setSettings({ projection: !state.settings.projection });
    document.body.classList.toggle('projection', state.settings.projection);
    teacher(root);
  };
  const drafts = Object.entries(state.drafts).filter(
    ([, d]) => d.text && ['essay', 'paragraph'].includes(d.kind),
  );
  $('#teacher-drafts', root).innerHTML = drafts.length
    ? drafts
        .map(
          ([key, d]) =>
            `<div class="list-row"><div class="grow"><strong>${e(d.title || '写作练习')}</strong><small>${e(d.text.slice(0, 50))}${d.text.length > 50 ? '……' : ''}</small></div><button class="btn" data-review-draft="${e(key)}">${d.reviewedAt ? '再查看' : '查看与检查'}</button></div>`,
        )
        .join('')
    : '<p class="muted">学生保存段落或作文后，会出现在这里。</p>';
  $$('[data-review-draft]', root).forEach(
    (b) => (b.onclick = () => reviewDraft(b.dataset.reviewDraft)),
  );
}
function reviewDraft(key) {
  const draft = state.drafts[key];
  if (!draft) return;
  const targets = (draft.targetIds || [])
    .map((id) => vocabulary.find((w) => w.id === id))
    .filter((w) => w && productionEligible(draft.text, w.word, 20));
  const modal = showModal(
    draft.title || '作文检查',
    `<div class="writing-preview">${highlight(
      draft.text,
      targets.map((w) => w.word),
    )}</div><hr><p>老师：请勾选已经确认用得自然、合理的词语。</p>${targets.map((w) => `<div class="check-row"><input type="checkbox" id="review-${e(w.id)}" data-approved-word="${e(w.id)}"><label for="review-${e(w.id)}">${e(w.word)}：用在完整、连贯的情境里</label></div>`).join('') || '<p class="muted">草稿中还没有可确认的目标词语。</p>'}<button class="btn primary" id="confirm-teacher-review" ${targets.length ? '' : 'disabled'}>确认选中词语的用法</button><p class="source-label">此确认由老师作出，不是自动作文评分。</p>`,
  );
  $('#confirm-teacher-review', modal).onclick = () => {
    const chosen = $$('[data-approved-word]:checked', modal).map((b) =>
      targets.find((w) => w.id === b.dataset.approvedWord),
    );
    if (!chosen.length) {
      toast('请先选择已检查的词语');
      return;
    }
    for (const w of chosen) attempt(w, 'reviewed', true, { answer: draft.text });
    draft.reviewedAt = new Date().toISOString();
    persist();
    closeModal();
    toast('已记录老师确认的词语用法');
  };
}
export function settings(root) {
  root.innerHTML = `${heading('学习设置', '按你的节奏，照顾好自己的学习记录。', false)}<div class="settings-grid"><section class="panel"><h2>练习偏好</h2><label>默认难度<select data-setting="difficulty">${[
    ['easy', '初级'],
    ['medium', '中级'],
    ['hard', '挑战'],
  ]
    .map(
      ([v, t]) =>
        `<option value="${v}" ${state.settings.difficulty === v ? 'selected' : ''}>${t}</option>`,
    )
    .join(
      '',
    )}</select></label><div class="check-row"><input type="checkbox" id="settings-hints" data-setting="hints" ${state.settings.hints ? 'checked' : ''}><label for="settings-hints">开启渐进提示</label></div><div class="check-row"><input type="checkbox" id="settings-projection" data-setting="projection" ${state.settings.projection ? 'checked' : ''}><label for="settings-projection">投影模式</label></div><p class="small muted">声音只会在你点击“听一听”时播放。如果设备没有华语语音，朗读按钮会停用。</p></section><section class="panel"><h2>备份与恢复</h2><p class="small muted">进度和草稿保存在此浏览器。换设备前，先导出一份备份。</p><button class="btn primary" id="export-progress">导出学习记录</button><label style="margin-top:18px">导入之前的备份<input id="import-progress" type="file" accept="application/json,.json"></label><p class="source-label">导入会替换当前记录。请先导出备份。</p></section><section class="panel"><h2>重新开始</h2><p class="small muted">“重做本题”只会清空当前答题。这里的重置会清空本应用的词语进度、经验、设置和写作草稿。</p><button class="btn danger" id="reset-progress">重置学习记录</button></section><section class="panel soft"><h2>关于训练营</h2><p>为华小三、四年级设计的词语 → 句子 → 作文练习。</p><p class="small muted">不需要注册。核心练习不依赖外部图片或网络服务。首次完整加载后，支持缓存的浏览器可离线继续练习。</p><a class="btn" href="#teacher">打开老师工具箱</a></section></div>`;
  $('#export-progress', root).onclick = () =>
    download(
      `华文训练营-学习备份-${dayKey()}.json`,
      JSON.stringify(state, null, 2),
      'application/json',
    );
  $('#reset-progress', root).onclick = () =>
    confirmAction(
      '重置全部学习记录？',
      '这会清空本应用在这台设备上的进度、收藏和草稿。请先导出备份。',
      () => {
        resetProgress();
        goHome();
      },
    );
  $('#import-progress', root).onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast('备份文件过大，请选择训练营导出的记录');
      return;
    }
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed.version !== 1 || !parsed.records || !parsed.settings) throw Error('invalid');
      const restored = hydrate(parsed);
      confirmAction('替换当前学习记录？', '导入会替换这台设备上现有的训练营记录和草稿。', () => {
        replaceState(restored);
        goHome();
        toast('学习记录已恢复');
      });
    } catch {
      toast('无法读取这份备份，请选择训练营导出的JSON文件');
    }
    event.target.value = '';
  };
}
