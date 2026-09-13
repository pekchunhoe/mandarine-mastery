import { vocabularyService } from '../js/vocabulary-service.js';
import { escapeHTML as e, prettyGrade } from '../js/utils.js';
import { refreshSpeech } from '../js/speech-service.js';
import { showModal, closeModal } from './modal.js';
import { vocabularyDetails } from './vocabulary-details.js';

export function openVocabularyDialog({ signal } = {}) {
  const controller = new AbortController();
  let page = 0;
  const size = 18;
  const modal = showModal('词语库', `<div class="vocabulary-dialog-search"><label for="lookup-search">搜索词语、近义词或中文释义</label><input id="lookup-search" type="search" placeholder="搜索词语、近义词或中文释义……" autocomplete="off"><p id="lookup-count" role="status" aria-live="polite"></p></div><div class="vocabulary-dialog-results" tabindex="0" aria-label="词语搜索结果"><div id="lookup-results"></div><div id="lookup-pages" class="pagination"></div></div>`, {
    className: 'vocabulary-dialog',
    closeLabel: '关闭词语库',
    onClose: () => {
      controller.abort();
      modal.style.removeProperty('--lookup-height');
      modal.style.removeProperty('--lookup-top');
      modal.replaceChildren();
    },
  });
  const search = modal.querySelector('#lookup-search');
  function draw() {
    const words = vocabularyService.searchWords(search.value);
    const pages = Math.max(1, Math.ceil(words.length / size));
    page = Math.min(page, pages - 1);
    modal.querySelector('#lookup-count').textContent = `${words.length} 条词语 · 第 ${page + 1} / ${pages} 页`;
    modal.querySelector('#lookup-results').innerHTML = words.slice(page * size, (page + 1) * size).map((word) => `<article class="word-card" data-lookup-word="${e(word.id)}"><div class="row between"><h3>${e(word.word)}</h3><span class="pill">${prettyGrade(word.grade)}</span></div>${vocabularyDetails(word)}</article>`).join('') || '<p class="empty-state">找不到相关词语，请尝试其他关键词、近义词或释义。</p>';
    modal.querySelector('#lookup-pages').innerHTML = pages > 1 ? `<button type="button" class="btn" data-lookup-page="-1" ${page === 0 ? 'disabled' : ''}>上一页</button><span>${page + 1} / ${pages}</span><button type="button" class="btn" data-lookup-page="1" ${page === pages - 1 ? 'disabled' : ''}>下一页</button>` : '';
    modal.querySelector('.vocabulary-dialog-results').scrollTop = 0;
    refreshSpeech(modal);
  }
  search.addEventListener('input', () => { page = 0; draw(); }, { signal: controller.signal });
  modal.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }, { signal: controller.signal });
  modal.addEventListener('click', (event) => {
    const button = event.target.closest('[data-lookup-page]');
    if (button) { page += Number(button.dataset.lookupPage); draw(); }
  }, { signal: controller.signal });
  // Follow the visible viewport when a phone keyboard reduces the available height.
  function fitViewport() {
    const viewport = window.visualViewport;
    if (!viewport) return;
    modal.style.setProperty('--lookup-height', `${viewport.height * 0.88}px`);
    modal.style.setProperty('--lookup-top', `${viewport.offsetTop + viewport.height / 2}px`);
  }
  window.visualViewport?.addEventListener('resize', fitViewport, { signal: controller.signal });
  window.visualViewport?.addEventListener('scroll', fitViewport, { signal: controller.signal });
  signal?.addEventListener('abort', closeModal, { once: true, signal: controller.signal });
  draw();
  fitViewport();
  search.focus({ preventScroll: true });
}
