import { loadVocabulary, state, setSettings, addTray, vocabulary } from './state.js';
import { escapeHTML as e, toast, $, prettyGrade } from './utils.js';
import { home, activityList, library, stats, teacher, settings } from './views.js';
import { runActivity } from './session.js';
import { wordModal, closeModal } from '../components/modal.js';
import { initSpeech, speak, speakSequence, refreshSpeech, stop, pause, resume, setSpeechRate } from './speech-service.js';
import { streak } from './mastery.js';
import { manageVocabulary } from '../components/vocabulary-library.js';
import { openTemporaryHelper, observeRouteChange, returnContext, returnToActivity, activitySnapshot } from './activity-context.js';

const nav = [
  ['home', '⌂', '学习花园'],
  ['activities', '▦', '自由练习'],
  ['review', '↻', '今日复习'],
  ['library', '▤', '词语库'],
  ['weak', '☆', '我的弱词'],
  ['stats', '↗', '成长记录'],
];
let cleanup;
function clearEssayHighlight(panel) {
  panel?.querySelectorAll?.('[data-essay-sentence]').forEach((sentence) => {
    sentence.classList.remove('essay-sentence--active');
    sentence.removeAttribute('aria-current');
  });
}
function highlightEssaySentence(panel, index) {
  const sentences = [...(panel?.querySelectorAll?.('[data-essay-sentence]') || [])];
  sentences.forEach((sentence, sentenceIndex) => {
    const active = sentenceIndex === index;
    sentence.classList.toggle('essay-sentence--active', active);
    if (active) sentence.setAttribute('aria-current', 'true');
    else sentence.removeAttribute('aria-current');
  });
  const active = sentences[index];
  if (!active) return;
  const bounds = active.getBoundingClientRect?.();
  if (bounds && (bounds.bottom < 0 || bounds.top > globalThis.innerHeight)) active.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
}
function render() {
  stop();
  cleanup?.();
  cleanup = null;
  const [path, query = ''] = (location.hash.slice(1) || 'home').split('?'),
    [page, activityId] = path.split('/'),
    params = new URLSearchParams(query);
  document.body.classList.toggle('projection', state.settings.projection);
  const active = page === 'activity' ? 'activities' : page;
  $('#app').innerHTML =
    `<div class="app-shell"><aside class="sidebar"><a class="brand" href="#home"><span class="brand-icon">文</span><div><strong>华文词语训练营</strong><small>GROW WORDS. TELL STORIES.</small></div></a><div><p class="nav-caption">我的学习空间</p><nav class="side-nav" aria-label="主导航">${nav.map(([id, icon, label]) => `<a class="${active === id ? 'active' : ''}" href="#${id}" ${active === id ? 'aria-current="page"' : ''}><span aria-hidden="true">${icon}</span>${label}</a>`).join('')}</nav></div><div><p class="nav-caption">学习小工具</p><nav class="side-nav"><a href="#teacher" class="${page === 'teacher' ? 'active' : ''}"><span>♧</span>老师工具箱</a><a href="#settings" class="${page === 'settings' ? 'active' : ''}"><span>⚙</span>学习设置</a></nav></div><div class="sidebar-bottom"><div class="garden-note"><strong>🌱 每个词，都能长成故事。</strong>不急着比速度，<br>认真写好自己的每一句。</div><p class="footer-note">为华小一至六年级而设计</p></div></aside><div class="workspace"><header class="topbar"><a class="mobile-brand" href="#home"><span class="brand-icon">文</span>华文词语训练营</a><div class="header-context"><span>我的学习空间</span>　/　<strong>${nav.find((n) => n[0] === active)?.[2] || { teacher: '老师工具箱', settings: '学习设置' }[page] || '学习花园'}</strong></div><div class="header-actions"><span class="pill header-streak">☀ ${streak(state.days)} 天</span><a href="#stats" class="pill gold"><span>✦</span><span class="xp-label">学习经验</span> ${state.xp} XP</a><a class="avatar" href="#settings" aria-label="打开学习设置">学</a></div></header><main id="main" tabindex="-1"></main></div><nav class="bottom-nav" aria-label="手机导航">${nav
      .filter((n) => ['home', 'activities', 'review', 'library', 'stats'].includes(n[0]))
      .map(
        ([id, icon, label]) =>
          `<a class="${active === id ? 'active' : ''}" href="#${id}" ${active === id ? 'aria-current="page"' : ''}><span aria-hidden="true">${icon}</span>${label}</a>`,
      )
      .join('')}</nav></div>`;
  const root = $('#main');
  try {
    if (page === 'home') home(root);
    else if (page === 'activities') activityList(root, params);
    else if (['library', 'weak', 'review'].includes(page)) library(root, page);
    else if (page === 'stats') stats(root);
    else if (page === 'teacher') teacher(root);
    else if (page === 'vocabulary-admin') cleanup = manageVocabulary(root);
    else if (page === 'settings') settings(root);
    else if (page === 'activity') cleanup = runActivity(root, activityId, params);
    else
      root.innerHTML =
        '<div class="empty-state"><h1>这条小路还没找到</h1><a class="btn primary" href="#home">回到学习花园</a></div>';
  } catch (error) {
    console.error(error);
    root.innerHTML =
      '<div class="empty-state"><h1>页面暂时无法显示</h1><p>请刷新后再试。保存的学习记录会保留。</p><a class="btn" href="#home">回到学习花园</a></div>';
  }
  const activityReturn = returnContext();
  if (activityReturn && page !== 'activity')
    root.insertAdjacentHTML('afterbegin', `<div class="activity-return-bar"><button type="button" class="btn quiet" data-return-activity aria-label="返回${e(activityReturn.sourceLabel)}">← 返回${e(activityReturn.sourceLabel)}</button><span class="small muted">正在使用${e(activityReturn.helperLabel)}</span></div>`);
  refreshSpeech();
  const snapshot = page === 'activity' ? activitySnapshot(location.hash) : null;
  requestAnimationFrame(() => window.scrollTo({ top: snapshot?.scrollPosition || 0, behavior: 'instant' }));
}
document.addEventListener('click', (event) => {
  const helper = event.target.closest('[data-open-helper]');
  if (helper) openTemporaryHelper({ helperType: helper.dataset.openHelper, helperLabel: helper.dataset.helperLabel || '学习工具', target: helper.getAttribute('href') });
  if (event.target.closest('[data-return-activity]')) {
    event.preventDefault();
    returnToActivity();
    return;
  }
  const resetSelection = event.target.closest('[data-reset-vocabulary-selection]');
  if (resetSelection) {
    setSettings({
      grade: 'mixed',
      lesson: 'all',
      category: 'all',
      wordDifficulty: 'all',
      tag: 'all',
      essayTopic: 'all',
    });
    render();
    return;
  }
  if (event.target.closest('[data-clear-vocabulary-filters]')) {
    setSettings({ category: 'all', wordDifficulty: 'all', tag: 'all', essayTopic: 'all' });
    render();
    return;
  }
  const word = event.target.closest('[data-word-card]');
  if (word) wordModal(word.dataset.wordCard);
  const essaySpeech = event.target.closest('[data-speak-essay]');
  if (essaySpeech && !essaySpeech.disabled) {
    const panel = essaySpeech.closest('.model-reading, .model-essay-reference');
    const sentences = [...(panel?.querySelectorAll?.('[data-essay-sentence]') || [])];
    if (sentences.length) {
      speakSequence(sentences.map((sentence) => sentence.textContent), {
        onSentenceStart: (index) => highlightEssaySentence(panel, index),
        onComplete: () => clearEssayHighlight(panel),
        onStop: () => clearEssayHighlight(panel),
      });
      return;
    }
  }
  const speech = event.target.closest('[data-speak]');
  if (speech && !speech.disabled) speak(speech.dataset.speak);
  const speechControl = event.target.closest('[data-speech-control]');
  if (speechControl) ({ pause, resume, stop })[speechControl.dataset.speechControl]?.();
  const speechRate = event.target.closest('[data-speech-rate]');
  if (speechRate) setSpeechRate(speechRate.dataset.speechRate);
  const tray = event.target.closest('[data-tray]');
  if (tray) {
    addTray(tray.dataset.tray);
    toast('已加入作文词语袋');
  }
  if (event.target.closest('[data-close-on-nav]')) closeModal();
});
document.addEventListener('change', (event) => {
  const key = event.target.dataset.setting;
  if (!key) return;
  const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
  const update = { [key]: value };
  if (key === 'grade') update.lesson = 'all';
  setSettings(update);
  render();
});
window.addEventListener('hashchange', () => {
  observeRouteChange(location.hash);
  closeModal();
  render();
});
window.addEventListener('offline', () => toast('已离线。加载过的词语和练习仍可继续使用。'));
async function start() {
  try {
    await loadVocabulary();
    initSpeech();
    render();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch (error) {
    console.error(error);
    $('#app').innerHTML =
      `<main class="empty-state"><span class="empty-icon">🌱</span><h1>还没有载入词语资料</h1><p>${e(error.message)}。请确认网络连接，稍后重试。</p><button class="btn primary" id="retry-load">重新载入</button></main>`;
    $('#retry-load').onclick = start;
  }
}
start();
