import { $, escapeHTML as e, highlight, toast, prettyGrade } from '../js/utils.js';
import { state, vocabulary, persist, addTray } from '../js/state.js';
import { aggregate, stage } from '../js/mastery.js';
import { practiceExample, editorial, editorialApplies } from '../data/content.js';
import { refreshSpeech, stop } from '../js/speech-service.js';
import { vocabularyDetails } from './vocabulary-details.js';
export function showModal(title, body, { className = '', closeLabel = '关闭', onClose } = {}) {
  const modal = $('#modal');
  modal.__cleanup?.();
  modal.__cleanup = onClose;
  modal.className = className;
  modal.__returnFocus = document.activeElement;
  modal.innerHTML = `<button class="icon-btn modal-close" data-close-modal aria-label="${e(closeLabel)}">×</button><h2 id="modal-title">${e(title)}</h2>${body}`;
  if (!modal.open) modal.showModal();
  modal.onclose = () => {
    // A queued close event from the previous panel must not clean up a reopened one.
    if (modal.open) return;
    stop();
    modal.__cleanup?.();
    modal.__cleanup = null;
    modal.className = '';
    const opener = modal.__returnFocus;
    if (opener?.isConnected) opener.focus?.({ preventScroll: true });
  };
  modal.querySelector('[data-close-modal]').onclick = () => { stop(); modal.close(); };
  refreshSpeech(modal);
  return modal;
}
export function closeModal() {
  stop();
  $('#modal').close();
}
export function wordModal(id) {
  const item = vocabulary.find((w) => w.id === id);
  if (!item) return;
  const r = aggregate(state, item.word),
    related = vocabulary.filter((w) => w.word === item.word);
  const examples = [...new Set(related.map(practiceExample))];
  const modal = showModal(
    '词语学习卡',
    `<div class="modal-word">${e(item.word)}</div>${vocabularyDetails(item, { pinyin: false, pronunciation: false })}<p>${e(item.pinyin)}</p><p>${e(item.meaningEnglish)} ${e(item.meaningMalay)}</p><p class="small">${e(item.partOfSpeech)} · ${e(item.category)} · ${item.tags.map(e).join('、')}</p><p class="small">${item.collocations.map(e).join(' · ')}</p><div class="row"><span class="pill">生字：${e(item.character)}</span><span class="pill">${stage(r.mastery)} · ${r.mastery}%</span></div><p class="quote" id="word-example">${highlight(examples[0], [item.word])}</p><p class="source-label">${editorialApplies(item) ? '补充教学例句' : '词表参考句'} · ${prettyGrade(item.grade)}${item.lesson ? ` · 第${e(item.lesson)}课` : ''}</p><div class="row"><button class="btn" data-speak="${e(item.word)}">🔊 词语</button><button class="btn" data-speak="${e(examples[0])}" id="speak-example">🔊 句子</button>${examples.length > 1 ? '<button class="btn" id="another-example">再看一句</button>' : ''}</div>${editorialApplies(item) ? `<details class="reference-details"><summary>查看词表原句与说明</summary><p>${e(item.example)}</p><p>${e(editorial[item.word].reason)}</p></details>` : ''}<p class="small muted">已练习 ${r.seen} 次 · 正确 ${r.correct} 次 · 自主造句练习 ${r.sentenceSuccess} 次</p><div class="action-bar"><a class="btn primary" href="#activity/builder?word=${encodeURIComponent(id)}" data-close-on-nav>造一个句子</a><a class="btn" href="#library" data-open-helper="vocabulary" data-helper-label="查词">查词库</a><button class="btn" id="favorite-word">${state.favorites.includes(id) ? '★ 已收藏' : '☆ 加入收藏'}</button><button class="btn" id="tray-word">＋ 加入作文</button></div>`,
  );
  $('#favorite-word', modal).onclick = (event) => {
    state.favorites = state.favorites.includes(id)
      ? state.favorites.filter((x) => x !== id)
      : [...state.favorites, id];
    persist();
    event.target.textContent = state.favorites.includes(id) ? '★ 已收藏' : '☆ 加入收藏';
  };
  $('#tray-word', modal).onclick = () => {
    addTray(id);
    toast('已经放进作文词语袋');
  };
  if (examples.length > 1) {
    let index = 0;
    $('#another-example', modal).onclick = () => {
      index = (index + 1) % examples.length;
      $('#word-example', modal).innerHTML = highlight(examples[index], [item.word]);
      $('#speak-example', modal).dataset.speak = examples[index];
    };
  }
}
export function confirmAction(title, message, onConfirm, confirmLabel = '确认重置') {
  const modal = showModal(
    title,
    `<p>${e(message)}</p><div class="action-bar"><button class="btn" id="cancel-confirm">取消</button><button class="btn danger" id="accept-confirm">${e(confirmLabel)}</button></div>`,
  );
  $('#cancel-confirm', modal).onclick = closeModal;
  $('#accept-confirm', modal).onclick = () => {
    closeModal();
    onConfirm();
  };
}
