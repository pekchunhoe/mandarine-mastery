import { vocabularyService } from './vocabulary-service.js';
import { freeSentence } from '../activities/sentenceBuilder.js';
import { state, filteredWords, vocabulary, attempt, persist } from './state.js';
import { aggregate, reviewQueue, streak } from './mastery.js';
import { escapeHTML as e, unique, highlight, toast, $, prettyGrade } from './utils.js';
import { activityById } from '../data/activities.js';
import { practiceExample } from '../data/content.js';
import { recognition } from '../activities/recognition.js';
import { matching } from '../activities/matching.js';
import { cloze } from '../activities/cloze.js';
import { memory } from '../activities/memory.js';
import { ordering } from '../activities/ordering.js';
import { sentenceBuilder } from '../activities/sentenceBuilder.js';
import { sentenceExpansion } from '../activities/sentenceExpansion.js';
import { sentenceDoctor } from '../activities/sentenceDoctor.js';
import { semantic } from '../activities/semantic.js';
import { writing } from '../activities/writing.js';
import { guidedEssayWriting, modelEssayStudy } from '../activities/essayTraining.js';
import { connectors } from '../activities/connectors.js';
import { treasure } from '../activities/treasure.js';
import { refreshSpeech } from './speech-service.js';
import { confirmAction } from '../components/modal.js';
import { activitySnapshot, clearActivitySnapshot, saveActivitySnapshot } from './activity-context.js';

const renderers = {
  recognition,
  matching,
  detective: cloze,
  cloze,
  memory,
  puzzle: ordering,
  builder: sentenceBuilder,
  expansion: sentenceExpansion,
  upgrade: sentenceExpansion,
  doctor: sentenceDoctor,
  multi: semantic,
  scene: semantic,
  classify: semantic,
  network: semantic,
  paragraph: ordering,
  paragraphBuilder: writing,
  essay: writing,
  planner: writing,
  assistant: writing,
  guidedEssay: guidedEssayWriting,
  modelEssay: modelEssayStudy,
  connectors,
  story: writing,
  treasure,
  timed: recognition,
};
const writingIds = ['paragraphBuilder', 'essay', 'planner', 'assistant', 'guidedEssay', 'modelEssay', 'story', 'treasure'];
const dailySteps = [
  { id: 'recognition', name: '认词', count: 2, difficulty: 'easy' },
  { id: 'cloze', name: '语境', count: 2, difficulty: 'easy' },
  { id: 'cloze', name: '回忆', count: 2, difficulty: 'hard' },
  { id: 'builder', name: '造句', count: 2, difficulty: 'hard' },
  { id: 'paragraphBuilder', name: '小写作', count: 1, difficulty: 'medium' },
];

export function runActivity(root, id, params) {
  const route = location.hash;
  const restored = activitySnapshot(route);
  let activity = activityById(id);
  if (!activity) {
    root.innerHTML =
      '<div class="empty-state"><h1>找不到这项练习</h1><a class="btn primary" href="#activities">返回自由练习</a></div>';
    return () => {};
  }
  const pool = filteredWords();
  if (!pool.length) {
    root.innerHTML = `<div class="empty-state"><h1>当前选择没有词语</h1><p>所选的年级、课次和词语筛选没有共同的词语。你可以使用全部词语开始练习，或回到词语库调整选择。</p><div class="action-bar" style="justify-content:center"><button class="btn primary" type="button" data-reset-vocabulary-selection="${e(id)}">使用全部词语开始</button><a class="btn" href="#library">调整词语选择</a></div></div>`;
    return () => {};
  }
  const daily = params.has('daily'),
    review = params.has('review'),
    specific = pool.find((w) => w.id === params.get('word'));
  let candidates = pool;
  let queue = specific
    ? [specific]
    : review
      ? reviewQueue(candidates, state, state.settings.count)
      : vocabularyService.getRandomWords({
          pool: candidates,
          count: state.settings.count,
          uniqueBy: ['recognition', 'matching', 'timed'].includes(id) ? 'character' : 'word',
        });
  if (daily) {
    const useful = pool.filter((w) => w.essayTopics.length);
    queue = reviewQueue(useful.length ? useful : pool, state, 5);
  }
  if (restored?.activityId === id && restored.queueIds?.length) {
    const resumedQueue = restored.queueIds.map((wordId) => pool.find((word) => word.id === wordId)).filter(Boolean);
    if (resumedQueue.length === restored.queueIds.length) queue = resumedQueue;
  }
  const focusWords = unique(queue, (w) => w.word);
  let round = restored?.activityId === id ? Math.min(restored.round || 0, Math.max(0, queue.length - 1)) : 0,
    step = restored?.activityId === id && daily ? Math.min(restored.step || 0, dailySteps.length - 1) : 0,
    sessionSuccess = restored?.activityId === id ? restored.sessionSuccess || 0 : 0,
    sessionMistakes = restored?.activityId === id ? restored.sessionMistakes || 0 : 0,
    sessionSkipped = restored?.activityId === id ? restored.sessionSkipped || 0 : 0,
    sessionXP = restored?.activityId === id ? restored.sessionXP || 0 : 0,
    controller,
    ctx,
    hintLevel = 0,
    remaining = 0,
    activeStarted = 0,
    timer,
    hasSummary = false;
  const timeAllowed =
    (params.has('timed') || state.settings.timed || id === 'timed') && !daily
      ? { recognition: 30, timed: 30, matching: 60, cloze: 90, detective: 90 }[id] || 0
      : 0;
  remaining = timeAllowed;
  if (restored?.activityId === id && timeAllowed) remaining = Math.min(timeAllowed, restored.remaining || timeAllowed);
  const sessionId = crypto.randomUUID();
  const snapshot = () => ({
    activityId: id,
    activityName: activity.name,
    queueIds: queue.map((word) => word.id),
    round, step, sessionSuccess, sessionMistakes, sessionSkipped, sessionXP, remaining,
    scrollPosition: globalThis.scrollY || 0,
  });
  function stopClock() {
    if (timer) clearInterval(timer);
    timer = null;
    if (activeStarted) {
      remaining = Math.max(0, remaining - (Date.now() - activeStarted) / 1000);
      activeStarted = 0;
    }
  }
  function beginClock() {
    if (!timeAllowed) return;
    activeStarted = Date.now();
    timer = setInterval(() => {
      const time = Math.max(0, remaining - (Date.now() - activeStarted) / 1000);
      const el = $('#session-timer', root);
      if (el) el.textContent = `◷ ${Math.ceil(time)} 秒`;
      if (time <= 0) {
        stopClock();
        summary(true);
      }
    }, 200);
  }
  function currentCount() {
    return daily
      ? Math.min(dailySteps[step].count, focusWords.length)
      : writingIds.includes(activity.id)
        ? 1
        : queue.length;
  }
  function currentItem() {
    return queue[round % queue.length];
  }
  function feedback(message, type = 'retry', html = false) {
    const box = $('#activity-feedback', root);
    box.hidden = false;
    box.className = `feedback ${type}`;
    box.innerHTML = html ? message : `<p>${e(message)}</p>`;
  }
  function draw() {
    controller?.abort();
    stopClock();
    controller = new AbortController();
    hintLevel = 0;
    if (daily) activity = activityById(dailySteps[step].id);
    const item = currentItem(),
      count = currentCount(),
      conceal = ['cloze', 'detective', 'scene'].includes(activity.id);
    const diff = daily ? dailySteps[step].difficulty : state.settings.difficulty;
    const recent = focusWords.filter((w) => !conceal || w.word !== item.word).slice(0, 5);
    root.innerHTML = `<div class="activity-toolbar"><a class="btn quiet" href="#activities">← 返回练习</a><div class="row">${timeAllowed ? `<span class="timer" id="session-timer">◷ ${Math.ceil(remaining)} 秒</span>` : ''}<span class="pill">${{ easy: '初级', medium: '中级', hard: '挑战' }[diff]}</span><button class="icon-btn" id="reset-activity" aria-label="重做本题">↻</button></div></div>${daily ? `<div class="session-strip">${dailySteps.map((s, i) => `<span class="${step === i ? 'current' : ''}">${i < step ? '✓ ' : ''}${s.name} · 约2分钟</span>`).join('')}</div>` : ''}<div class="activity-title-row"><span class="activity-icon">${activity.icon}</span><div><h1>${activity.name}</h1><p>${daily ? '今日10分钟 · ' : ''}${round + 1} / ${count} ${writingIds.includes(activity.id) ? '次写作' : '题'} · ${prettyGrade(item.grade)}${item.lesson ? ` · 第${e(item.lesson)}课` : ''}</p></div></div>${id === 'timed' ? '<div class="stage-tabs"><a class="toggle active" href="#activity/timed">30秒认词</a><a class="toggle" href="#activity/matching?timed=1">60秒配词</a><a class="toggle" href="#activity/cloze?timed=1">90秒填空</a></div>' : ''}<div class="activity-layout ${writingIds.includes(activity.id) ? 'writing-layout' : ''}"><section class="activity-main"><div class="question-card"><div id="activity-body"></div><div id="hint-output" class="hint-box" hidden aria-live="polite"></div><div id="activity-feedback" class="feedback" hidden role="status" aria-live="polite"></div><div id="activity-complete" hidden></div></div><div class="action-bar">${state.settings.hints ? '<button class="btn" id="get-hint">☀ 给我一点提示</button>' : ''}<button class="btn quiet" id="skip-question">${writingIds.includes(activity.id) ? '先保存，下次再写' : '先跳过，稍后再练'}</button></div></section><aside class="activity-aside"><section class="panel soft"><span class="eyebrow">这一步，练习什么？</span><h3 style="margin-top:12px">${activity.desc}</h3><p class="small muted">${writingIds.includes(activity.id) ? '把学过的词写进真实的生活情境。草稿会自动保存。' : activity.stage >= 3 ? '读出意思，动手组织语言。清楚、自然的表达最重要。' : '先看清楚，再想一想。每次练习都可以按自己的节奏来。'}</p><hr><div class="row between"><span class="small">这次已完成</span><strong>${sessionSuccess} 项</strong></div><div class="row between"><span class="small">获得学习经验</span><strong>${sessionXP} XP</strong></div></section><section class="panel"><h3>一起练习的词语</h3><div class="chip-tray">${recent.map((w) => `<button class="word-chip" data-word-card="${e(w.id)}">${e(w.word)}</button>`).join('') || '<p class="small muted">答案先藏起来，试着回忆。</p>'}</div><p class="small muted" style="margin-top:14px">它们也会陪你走进下一次造句和写作。</p></section><p class="notice">🌱 答错没关系。看看提示，再试一次。进步比速度更重要。</p></aside></div>`;
    ctx = {
      item,
      pool,
      focusWords,
      round,
      activity,
      difficulty: diff,
      params,
      signal: controller.signal,
      finished: false,
      note: (message) => feedback(message),
      hintUsed: () => hintLevel++,
      fail: (message, answer, kind = 'context', mistakeItem = item) => {
        if (ctx.finished) return;
        sessionMistakes++;
        attempt(mistakeItem, kind, false, { answer, error: message, session: sessionId });
        feedback(`再想一想。${message}`);
      },
      complete: ({
        kind = 'context',
        items = [item],
        answer = '',
        message = '答对了！',
        html = false,
      }) => {
        if (ctx.finished) return;
        ctx.finished = true;
        stopClock();
        sessionSuccess++;
        for (const word of unique(items, (w) => w.word)) {
          const result = attempt(word, kind, true, { hint: hintLevel, answer, session: sessionId });
          sessionXP += result.xp;
        }
        const counters = root.querySelectorAll('.activity-aside .row.between strong');
        if (counters[0]) counters[0].textContent = `${sessionSuccess} 项`;
        if (counters[1]) counters[1].textContent = `${sessionXP} XP`;
        const xpHeader = document.querySelector('.header-actions .pill.gold');
        if (xpHeader)
          xpHeader.innerHTML = `<span>✦</span><span class="xp-label">学习经验</span> ${state.xp} XP`;
        const streakHeader = document.querySelector('.header-streak');
        if (streakHeader) streakHeader.textContent = `☀ ${streak(state.days)} 天`;
        // No feedback claims semantic correctness for typed production.
        const production = ['sentence', 'paragraph'].includes(kind);
        feedback(
          `<h3>${production ? '✍ 练习已记录' : '✓ 完成了！'}</h3>${html ? message : `<p>${e(message)}</p>`}`,
          '',
          true,
        );
        const done = $('#activity-complete', root);
        done.hidden = false;
        done.innerHTML = `<div class="action-bar">${items.length ? `<button class="btn" data-speak="${e(production ? answer : practiceExample(item))}">🔊 听一听</button>` : ''}<button class="btn primary" id="next-question">${round + 1 < count ? '下一题 →' : daily && step < dailySteps.length - 1 ? '进入下一站 →' : '看看我的收获 →'}</button></div><div class="self-assess"><p>这个词语，我会不会？</p><div class="row">${[
          ['easy', '😄 我会了'],
          ['practice', '🙂 还要练习'],
          ['hard', '🤔 不太会'],
        ]
          .map(([value, text]) => `<button class="btn" data-rating="${value}">${text}</button>`)
          .join(
            '',
          )}</div><p class="source-label">自评帮助安排复习，不会单独提高掌握等级。</p></div>`;
        $('#next-question', root).onclick = next;
        done.querySelectorAll('[data-rating]').forEach(
          (b) =>
            (b.onclick = () => {
              const record = state.records[item.id];
              if (record) {
                record.selfRating = b.dataset.rating;
                if (b.dataset.rating !== 'easy') record.due = new Date().toISOString();
                persist();
              }
              done
                .querySelectorAll('[data-rating]')
                .forEach((x) => x.classList.toggle('primary', x === b));
            }),
        );
        refreshSpeech();
      },
    };
    try {
      const needsExample = ['cloze', 'detective', 'memory', 'doctor', 'expansion', 'upgrade'];
      if (needsExample.includes(activity.id) && !practiceExample(item).includes(item.word)) {
        freeSentence($('#activity-body', root), ctx);
        $('#activity-body', root).insertAdjacentHTML(
          'afterbegin',
          '<p class="notice">这个词尚无包含目标词的例句。先练习自主造句，或请老师补充例句。</p>',
        );
      } else {
        if (activity.id === 'memory')
          ctx.pool = pool.filter((w) => practiceExample(w).includes(w.word));
        renderers[activity.id]($('#activity-body', root), ctx);
      }
    } catch (error) {
      console.error(error);
      $('#activity-body', root).innerHTML =
        '<h2>这道题暂时无法显示</h2><p>请跳过这题，或回到词语库换个词语。</p>';
    }
    $('#reset-activity', root).onclick = () =>
      confirmAction('重做本题？', '只清空本题的选择。学习记录和已保存的作文草稿会保留。', draw);
    $('#skip-question', root).onclick = () => {
      if (writingIds.includes(activity.id)) {
        toast('已保存的草稿可以从同一活动继续');
        location.hash = 'activities';
      } else {
        if (!ctx.finished) sessionSkipped++;
        const r = state.records[item.id];
        if (r) {
          r.due = new Date().toISOString();
          persist();
        }
        next();
      }
    };
    $('#get-hint', root)?.addEventListener('click', () => {
      if (ctx.finished) return;
      hintLevel++;
      const examples = unique(vocabulary.filter((w) => w.word === item.word).map(practiceExample));
      const alternate = examples.find((s) => s !== practiceExample(item));
      const hints = [
        `这个词来自生字“${item.character}”。`,
        `词语的第一个字是“${item.word[0]}”，一共有${[...item.word].length}个字。`,
        alternate || practiceExample(item),
        `参考答案：${['puzzle', 'doctor'].includes(activity.id) ? practiceExample(item) : item.word}`,
      ];
      const box = $('#hint-output', root);
      box.hidden = false;
      box.innerHTML = `提示 ${Math.min(4, hintLevel)} / 4：${highlight(hints[Math.min(3, hintLevel - 1)], [item.word])}`;
    });
    refreshSpeech();
    beginClock();
    saveActivitySnapshot(route, snapshot());
  }
  function next() {
    stopClock();
    round++;
    if (round >= currentCount()) {
      if (daily && step < dailySteps.length - 1) {
        step++;
        round = 0;
        draw();
      } else summary();
    } else draw();
  }
  function summary(expired = false) {
    controller?.abort();
    stopClock();
    hasSummary = true;
    clearActivitySnapshot(route);
    const attempts =
        sessionSuccess + sessionMistakes + sessionSkipped + (expired && !ctx.finished ? 1 : 0),
      accuracy = attempts ? Math.round((sessionSuccess / attempts) * 100) : 0;
    const speed =
      timeAllowed && sessionSuccess
        ? Math.round(Math.min(100, (remaining / timeAllowed) * 100))
        : 0;
    const score = attempts ? Math.round(accuracy * 0.7 + speed * 0.3) : 0;
    root.innerHTML = `<div class="panel empty-state"><span class="empty-icon">🌿</span><span class="eyebrow">${daily ? '今日小课堂' : '这次练习'} · 我的收获</span><h1 style="margin-top:16px">${expired ? '时间到了，看看你的收获。' : sessionSuccess ? '又向“会使用”走近了一步。' : '休息一下，准备好再来。'}</h1><p class="muted">${sessionSuccess ? '今天你不仅在认识词语，也在练习怎样用它们。' : '这一轮还没有完成的题目。可以慢慢来，不用着急。'}</p><div class="summary-score">${sessionXP}<small> XP</small></div><p>完成 ${sessionSuccess} 项 · 需要再想想 ${sessionMistakes} 次</p>${timeAllowed ? `<p>本次挑战 ${score} 分 · 准确率占70%，速度占30%</p><p class="small muted">速度只计算答题时间。做得准，比做得快更重要。</p>` : ''}<div class="chip-tray" style="justify-content:center">${focusWords
      .slice(0, 8)
      .map((w) => `<button class="word-chip" data-word-card="${e(w.id)}">${e(w.word)}</button>`)
      .join(
        '',
      )}</div><div class="action-bar" style="justify-content:center"><a class="btn primary" href="#activity/essay">把词语写进作文 →</a><a class="btn" href="#stats">看看成长记录</a><a class="btn quiet" href="#home">回到花园</a></div></div>`;
  }
  draw();
  return () => {
    if (!hasSummary) saveActivitySnapshot(route, snapshot());
    controller?.abort();
    stopClock();
    globalThis.speechSynthesis?.cancel();
  };
}
