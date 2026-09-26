import { escapeHTML as e, toast } from '../js/utils.js';
import { aiTeacher, AIError } from '../js/ai-teacher.js';
import {
  TUTOR_ACTION as A,
  TUTOR_ACTIVITY,
  tutorActions,
  activityTutorActions,
  tutorLoading,
} from '../js/tutor-actions.js';
import { vocabularyDetails } from './vocabulary-details.js';
import { showModal, closeModal } from './modal.js';
import { openVocabularyDialog } from './vocabulary-dialog.js';
import { refreshSpeech } from '../js/speech-service.js';
import { copyText } from '../js/clipboard.js';

// A workflow may expose only the actions that make sense at its current scope.
// Guided essay writing uses this to keep paragraph tools beside the paragraph editor.
export const aiToolbar = (
  activity = TUTOR_ACTIVITY.ESSAY,
  actions = activityTutorActions[activity],
) =>
  '<section class="ai-toolbar" aria-label="AI老师"><strong>✨ AI老师 · 想一想，自己写</strong><div class="ai-actions">' +
  actions
    .filter((action) => activityTutorActions[activity]?.includes(action))
    .map(
      (action) =>
        '<button type="button" class="btn" data-ai-action="' +
        action +
        '" aria-haspopup="dialog">' +
        tutorActions[action].label +
        '</button>',
    )
    .join('') +
  '</div><p class="small muted">点击后会提交相关写作内容取得建议。请勿填写个人资料；由你来决定怎样修改。</p></section>';
const list = (items) => '<ul>' + items.map((item) => '<li>' + e(item) + '</li>').join('') + '</ul>';
const paragraph = (text) => '<p>' + e(text) + '</p>';
const section = (title, html) => '<section><h3>' + title + '</h3>' + html + '</section>';
const why = (text) =>
  '<details class="reference-details"><summary>❓ 为什么？</summary>' +
  paragraph(text) +
  '</details>';
const article = (title, html) => '<article><h4>' + e(title) + '</h4>' + html + '</article>';
const categoryNames = {
  topicRelevance: '切题',
  structure: '结构',
  description: '描写',
  vocabulary: '词语',
  language: '语言',
};
const issueNames = {
  word_choice: '用词',
  grammar: '语法',
  punctuation: '标点',
  meaning: '意思',
  repetition: '重复',
};
export function tutorResultHTML(action, data) {
  let html = '';
  if (data.original !== undefined) html += section('你的原句', paragraph(data.original));
  if (action === A.SENTENCE_HINT) {
    html += section('💡 想一想', list(data.thinkingQuestions));
    if (data.usefulPatterns.length) html += section('可以试试的句式', list(data.usefulPatterns));
  } else if (action === A.SENTENCE_CHECK) {
    html += section(
      data.status === 'correct' ? '✅ 句子没有发现明显错误' : '🔍 需要检查的地方',
      data.issues
        .map((item) =>
          article(
            issueNames[item.category] || '表达',
            paragraph(item.text) + why(item.explanation),
          ),
        )
        .join(''),
    );
    if (data.styleSuggestions.length)
      html += section(
        '💡 可选的表达建议（原句不一定有错）',
        data.styleSuggestions
          .map((item) => article('可以试一试', paragraph(item.text) + why(item.explanation)))
          .join(''),
      );
    if (data.suggestedRevision)
      html += section('✨ 修改示范（请自己决定）', paragraph(data.suggestedRevision));
  } else if (action === A.SENTENCE_EXPAND) {
    html += section(
      '🌱 一步一步扩写',
      data.levels
        .map((item) => article('第 ' + item.level + ' 步：' + item.focus, paragraph(item.example)))
        .join(''),
    );
  } else if (action === A.SENTENCE_VIVID) {
    html += section(
      '💡 可以试试的描写',
      data.techniques.map((item) => article(item.type, paragraph(item.suggestion))).join(''),
    );
    html +=
      section('✨ 示范', paragraph(data.example)) +
      section('试着自己填一填', paragraph(data.tryYourself));
  } else if ([A.PARAGRAPH_EXPAND, A.PARAGRAPH_VIVID].includes(action)) {
    html += section(
      '💡 改进建议',
      data.suggestions.map((item) => article(item.focus, paragraph(item.suggestion))).join(''),
    );
    html += section(
      '参考写法（请自己决定怎样修改）',
      paragraph(data.example) +
        why(data.explanation) +
        '<button type="button" class="btn" data-ai-copy>复制参考写法</button>',
    );
  } else if (action === A.VOCABULARY_HELP) {
    html += section(
      '📚 好词推荐',
      data.recommendations
        .map((item) => {
          const word = item.vocabulary;
          if (
            !word ||
            (item.source !== 'ai' && (!item.vocabularyId || word.id !== item.vocabularyId))
          )
            throw new Error('Invalid vocabulary response');
          return (
            '<article class="word-card"><h4>' +
            e(word.word) +
            '</h4><span class="small muted">' +
            (item.source === 'ai' ? 'AI推荐' : '词库') +
            '</span>' +
            vocabularyDetails(word) +
            paragraph('AI用法提示：' + item.reason) +
            paragraph('AI例句：' + item.exampleUsage) +
            '</article>'
          );
        })
        .join('') || paragraph('这次没有合适的推荐，可以打开词语库自己找一找。'),
    );
  } else if (action === A.ESSAY_NEXT_STEP) {
    html += section('你已经写到这里', paragraph(data.currentProgress));
    html += section(
      '💡 下一步想一想',
      data.directions.map((item) => article(item.title, paragraph(item.prompt))).join(''),
    );
  } else if (action === A.PARAGRAPH_REVIEW) {
    html += section('✅ 做得好的地方', list(data.strengths));
    html += section(
      '🔍 可以改进',
      data.issues
        .map((item) => article(item.type, paragraph(item.text) + list(item.suggestions)))
        .join('') || paragraph('这次没有发现需要特别指出的问题。'),
    );
    if (data.missingDetails.length)
      html += section('💡 还可以加入的细节', list(data.missingDetails));
    html += section('先改一个地方', paragraph(data.revisionFocus));
  } else if (action === A.ESSAY_REVIEW) {
    html += section('🩺 作文体检', paragraph(data.summary));
    html += Object.entries(categoryNames)
      .map(([key, name]) =>
        section(
          name + (data.categories[key].status === 'good' ? ' · ✅ 做得好' : ' · 💡 可改善'),
          paragraph(data.categories[key].feedback),
        ),
      )
      .join('');
    html += section('🔍 优先修改', list(data.priorityImprovements));
  }
  return html + section('🎯 轮到你了', paragraph(data.studentTask));
}

export function attachAITeacher(root, { signal, getRequest }) {
  let active,
    version = 0,
    cooldownUntil = 0,
    cooldownTimer;
  const coolingDown = () => Date.now() < cooldownUntil;
  const updateButtons = () =>
    root.querySelectorAll('[data-ai-action]').forEach((button) => {
      button.disabled =
        coolingDown() || (!!active?.pending && button.dataset.aiAction === active.action);
    });
  const startCooldown = (seconds) => {
    cooldownUntil = Math.max(cooldownUntil, Date.now() + seconds * 1000);
    clearTimeout(cooldownTimer);
    cooldownTimer = setTimeout(
      () => {
        cooldownTimer = undefined;
        updateButtons();
      },
      Math.max(0, cooldownUntil - Date.now()),
    );
    updateButtons();
  };
  function open(action, opener) {
    active?.dispose();
    const session = { version: ++version, action, pending: false };
    active = session;
    const controller = new AbortController();
    let closed = false;
    const current = () => !closed && active === session && !signal?.aborted;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      controller.abort();
      if (active === session) {
        active = null;
        updateButtons();
      }
    };
    const request = getRequest(action);
    const modal = showModal(
      tutorActions[action].label,
      '<p class="small muted">' +
        e(request.scopeLabel || '建议仅供参考，请保留自己的想法和表达。') +
        '</p><div class="ai-result" aria-live="polite" aria-busy="true"></div><div class="action-bar"><button type="button" class="btn" data-ai-retry hidden>再试一次</button><button type="button" class="btn" data-ai-vocabulary>打开词语库</button></div>',
      { className: 'ai-dialog', onClose: cleanup },
    );
    modal.__returnFocus = opener;
    modal.querySelector('[data-close-modal]').onclick = () => {
      cleanup();
      closeModal();
    };
    modal.addEventListener('cancel', cleanup, { signal: controller.signal });
    modal.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Tab') return;
        const focusable = [
          ...modal.querySelectorAll(
            'button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((element) => element.getClientRects().length);
        const first = focusable[0],
          last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      },
      { signal: controller.signal },
    );
    session.dispose = () => {
      cleanup();
    };
    const content = modal.querySelector('.ai-result'),
      retry = modal.querySelector('[data-ai-retry]');
    const run = async () => {
      if (!current() || session.pending) return;
      session.pending = true;
      updateButtons();
      retry.hidden = true;
      content.setAttribute('aria-busy', 'true');
      content.innerHTML = '<p role="status">' + tutorLoading(action) + '</p>';
      try {
        const data = await aiTeacher[action](request, { signal: controller.signal });
        if (!current()) return;
        content.innerHTML = tutorResultHTML(action, data);
        const copy = content.querySelector('[data-ai-copy]');
        if (copy)
          copy.onclick = async () => {
            const copied = await copyText(data.example);
            if (current())
              toast(
                copied
                  ? '参考写法已复制，请自己决定怎样修改'
                  : '未能复制，请长按参考写法选择文字复制',
              );
          };
        refreshSpeech(modal);
      } catch (error) {
        if (!current()) return;
        const message =
          error instanceof AIError ? error.message : 'AI老师这次的回复不完整，请再试一次。';
        content.innerHTML = '<p role="alert">' + e(message) + '</p>';
        if (error instanceof AIError && error.retryAfterSeconds)
          startCooldown(error.retryAfterSeconds);
        retry.hidden = coolingDown();
        toast(message);
      } finally {
        if (current()) {
          session.pending = false;
          updateButtons();
          content.setAttribute('aria-busy', 'false');
        }
      }
    };
    retry.onclick = run;
    modal.querySelector('[data-ai-vocabulary]').onclick = () => {
      openVocabularyDialog({ signal });
      modal.__returnFocus = opener;
    };
    run();
  }
  root.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest('[data-ai-action]');
      if (
        !button ||
        coolingDown() ||
        (active?.pending && active.action === button.dataset.aiAction)
      )
        return;
      open(button.dataset.aiAction, button);
    },
    { signal },
  );
  signal?.addEventListener(
    'abort',
    () => {
      clearTimeout(cooldownTimer);
      if (!active) return;
      active.dispose();
      const modal = document.querySelector('#modal');
      if (modal?.open && modal.classList.contains('ai-dialog')) closeModal();
    },
    { once: true },
  );
}
