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
import { keywordReminder } from '../js/sentence-keyword.js';

// A workflow may expose only the actions that make sense at its current scope.
// Guided essay writing uses this to keep paragraph tools beside the paragraph editor.
export const aiToolbar = (
  activity = TUTOR_ACTIVITY.ESSAY,
  actions = activityTutorActions[activity],
  { extraActions = '' } = {},
) =>
  '<section class="ai-toolbar" aria-label="AI老师"><strong>' +
  (activity === TUTOR_ACTIVITY.ESSAY
    ? '🤖 AI老师 · 根据题目和我写的内容帮助我'
    : '✨ AI老师 · 想一想，自己写') +
  '</strong><div class="ai-actions">' +
  actions
    .filter((action) => activityTutorActions[activity]?.includes(action))
    .map(
      (action) =>
        (activity === TUTOR_ACTIVITY.SENTENCE ? '<span class="sentence-ai-action" role="group" aria-label="' + e(tutorActions[action].label) + '">' : '') +
        '<button type="button" class="btn" data-ai-action="' +
        action +
        '" aria-haspopup="dialog">' +
        tutorActions[action].label +
        '</button>' +
        (activity === TUTOR_ACTIVITY.SENTENCE
          ? '<button type="button" class="btn sentence-copy-prompt" data-sentence-copy-prompt="' + action +
            '" title="复制提示词" aria-label="复制「' + e(tutorActions[action].label.replace(/^[^\p{Script=Han}]+/u, '')) +
            '」提示词"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/></svg></button></span>' : ''),
    )
    .join('') +
  extraActions +
  '</div><p class="small muted">' +
  (activity === TUTOR_ACTIVITY.ESSAY
    ? 'AI老师会参考所选题目和你自己写的内容；本地提示和范句不会提交。请勿填写个人资料；由你来决定怎样修改。'
    : '点击后会提交相关写作内容取得建议。请勿填写个人资料；由你来决定怎样修改。') +
  '</p></section>';
const list = (items) => '<ul>' + items.map((item) => '<li>' + e(item) + '</li>').join('') + '</ul>';
const exampleList = (examples, sentence = false) =>
  '<ul class="ai-example-list">' +
  examples
    .map(
      (example, index) =>
        '<li class="ai-example"><span class="ai-example-text">' +
        e(example) +
        '</span><button type="button" class="btn ai-example-copy' + (sentence ? ' sentence-example-copy' : '') + '" data-ai-example-copy="' +
        index +
        '" aria-label="复制第' + (index + 1) + '句参考句子">' + (sentence ? '📋 复制句子' : '复制示例') + '</button></li>',
    )
    .join('') +
  '</ul>';
const paragraph = (text) => '<p>' + e(text) + '</p>';
const section = (title, html) => '<section><h3>' + title + '</h3>' + html + '</section>';
const why = (text) =>
  '<details class="reference-details"><summary>❓ 为什么？</summary>' +
  paragraph(text) +
  '</details>';
const article = (title, html) => '<article><h4>' + e(title) + '</h4>' + html + '</article>';
const completeScaffold = (text) => typeof text === 'string' && /[。！？!?][”’」』"')）]*\s*$/u.test(text) && !/_{2,}|…|\.{3,}|□|＿/u.test(text);
// Explicit validated model fields only. Never split Chinese sentence punctuation
// or include the student's original, headings, scaffolds or explanation fields.
export function sentenceCopyValues(action, data) {
  const values = new Map();
  const add = (key, text) => { if (typeof text === 'string' && text.trim()) values.set(key, text); };
  (data.examples || []).forEach((text, index) => add(`example:${index}`, text));
  if (action === A.SENTENCE_HINT) (data.usefulPatterns || []).forEach((text, index) => {
    if (completeScaffold(text)) add(`pattern:${index}`, text);
  });
  if (action === A.SENTENCE_CHECK) add('revision', data.suggestedRevision);
  if (action === A.SENTENCE_EXPAND) data.levels.forEach((item, index) => add(`level:${index}`, item.example));
  if (action === A.SENTENCE_VIVID) {
    add('vivid', data.example);
    if (completeScaffold(data.tryYourself)) add('try-yourself', data.tryYourself);
  }
  if (action === A.VOCABULARY_HELP) data.recommendations.forEach((item, index) => {
    add(`vocabulary:${index}`, item.exampleUsage);
    if (item.source === 'ai' && item.vocabulary.exampleSentence !== item.exampleUsage)
      add(`vocabulary-reference:${index}`, item.vocabulary.exampleSentence);
  });
  return values;
}
const modelParagraph = (text, key, enabled, label = '') => enabled
  ? '<div class="sentence-ai-model"><p class="ai-example-text">' + e(label) + e(text) +
    '</p><button type="button" class="btn ai-example-copy sentence-example-copy" data-ai-sentence-copy="' + key +
    '" aria-label="复制这句参考句子">📋 复制句子</button></div>'
  : paragraph(label + text);
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
export function tutorResultHTML(action, data, { keyword, scenarioAware = false } = {}) {
  let html = '';
  if (action === A.PARAGRAPH_HINT)
    return (
      section('💡 可以写什么', list(data.ideas)) +
      section('✏️ 参考写法', exampleList(data.examples)) +
      section('🎯 小提醒', paragraph(data.studentTask))
    );
  if (data.original !== undefined) html += section('你的原句', paragraph(data.original));
  if (action === A.SENTENCE_HINT) {
    html += section(scenarioAware ? '💡 你可以这样写' : '💡 想一想', list(data.thinkingQuestions));
    if (data.usefulPatterns.length) html += section('可以试试的句式', '<ul>' + data.usefulPatterns.map((text, index) =>
      '<li>' + (keyword && completeScaffold(text) ? modelParagraph(text, `pattern:${index}`, true) : e(text)) + '</li>').join('') + '</ul>');
    if (data.examples?.length) html += section('✏️ 参考句子', exampleList(data.examples, !!keyword));
  } else if (action === A.SENTENCE_CHECK) {
    if (scenarioAware) html += section('🔍 句子检查', data.strengths?.length ? section('✅ 写得好的地方', list(data.strengths)) : '');
    html += section(
      data.status === 'correct' ? '✅ 句子没有发现明显错误' : (scenarioAware ? '🔧 可以改进的地方 · 🔍 需要检查的地方' : '🔍 需要检查的地方'),
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
        scenarioAware ? '🔧 可以改进的地方 · 💡 可选的表达建议（原句不一定有错）' : '💡 可选的表达建议（原句不一定有错）',
        data.styleSuggestions
          .map((item) => article('可以试一试', paragraph(item.text) + why(item.explanation)))
          .join(''),
      );
    if (data.suggestedRevision)
      html += section(scenarioAware ? '✏️ 修改建议' : '✨ 修改示范（请自己决定）', modelParagraph(data.suggestedRevision, 'revision', !!keyword));
  } else if (action === A.SENTENCE_EXPAND) {
    html += section(
      scenarioAware ? '🌱 扩写后的句子' : '🌱 一步一步扩写',
      data.levels
        .map((item, index) => article('第 ' + item.level + ' 步' + (scenarioAware ? '' : '：' + item.focus), modelParagraph(item.example, `level:${index}`, !!keyword) + (scenarioAware ? paragraph('💡 我加入了什么？' + item.focus) : '')))
        .join(''),
    );
  } else if (action === A.SENTENCE_VIVID) {
    html += section(
      scenarioAware ? '🌟 生动在哪里？' : '💡 可以试试的描写',
      data.techniques.map((item) => article(item.type, paragraph(item.suggestion))).join(''),
    );
    html +=
      section(scenarioAware ? '✨ 更生动的句子' : '✨ 示范', modelParagraph(data.example, 'vivid', !!keyword)) +
      section('试着自己填一填', modelParagraph(data.tryYourself, 'try-yourself', !!keyword && completeScaffold(data.tryYourself)));
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
      scenarioAware ? '📚 适合这个情景的好词' : '📚 好词推荐',
      data.recommendations
        .map((item, index) => {
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
            vocabularyDetails(word, { example: !keyword }) +
            paragraph('AI用法提示：' + item.reason) +
            modelParagraph(item.exampleUsage, `vocabulary:${index}`, !!keyword, 'AI例句：') +
            (keyword && item.source === 'ai' && word.exampleSentence !== item.exampleUsage
              ? modelParagraph(word.exampleSentence, `vocabulary-reference:${index}`, true, '补充例句：') : '') +
            '</article>'
          );
        })
        .join('') || paragraph('这次没有合适的推荐，可以打开词语库自己找一找。'),
    );
    if (data.examples?.length) html += section('✏️ 参考句子', exampleList(data.examples, !!keyword));
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

export function attachAITeacher(root, { signal, getRequest, getContextKey }) {
  let active,
    version = 0,
    cooldownUntil = 0,
    cooldownTimer;
  const coolingDown = () => Date.now() < cooldownUntil;
  const updateButtons = () => {
    root.querySelectorAll('[data-ai-action]').forEach((button) => {
      button.disabled =
        coolingDown() || (!!active?.pending && button.dataset.aiAction === active.action);
    });
    if (active?.failed && active.retryButton)
      active.retryButton.hidden = coolingDown() || active.pending;
  };
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
    const session = { version: ++version, action, pending: false, contextKey: getContextKey?.() };
    active = session;
    const controller = new AbortController();
    let closed = false;
    const current = () => !closed && active === session && !signal?.aborted &&
      (!getContextKey || session.contextKey === getContextKey());
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
    const keyword = request.activity === TUTOR_ACTIVITY.SENTENCE && request.context.topic;
    const targetNotice = keyword
      ? '<div class="sentence-target"><strong>本次造句词语：</strong><mark>' + e(keyword) + '</mark></div>' +
        (request.context.keywordMode ? '<p class="small muted">我的情境：' + e(request.context.situation || '请先填写情境') + '</p>' : '') +
        (request.context.studentSentence?.trim() && !request.context.studentSentence.includes(keyword)
          ? '<p role="status">' + e(keywordReminder(keyword)) + '</p>' : '')
      : '';
    const modal = showModal(
      tutorActions[action].label,
      targetNotice + '<p class="small muted">' +
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
    session.retryButton = retry;
    const run = async () => {
      if (!current() || session.pending) return;
      session.pending = true;
      session.failed = false;
      updateButtons();
      retry.hidden = true;
      content.setAttribute('aria-busy', 'true');
      content.innerHTML = '<p role="status">' + tutorLoading(action) + '</p>';
      try {
        const data = await aiTeacher[action](request, { signal: controller.signal });
        if (!current()) return;
        content.innerHTML = tutorResultHTML(action, data, {
          keyword: request.activity === TUTOR_ACTIVITY.SENTENCE ? request.context.topic : undefined,
          scenarioAware: !!request.context.keywordMode && request.activity === TUTOR_ACTIVITY.SENTENCE,
        });
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
        content.querySelectorAll('[data-ai-example-copy]').forEach((button) => {
          button.onclick = async () => {
            if (!current()) return;
            const copied = await copyText(data.examples[Number(button.dataset.aiExampleCopy)]);
            if (current())
              toast(
                copied
                  ? '已复制 ✓'
                  : '未能复制，请长按示例选择文字复制',
              );
          };
        });
        if (request.activity === TUTOR_ACTIVITY.SENTENCE) {
          const sentences = sentenceCopyValues(action, data);
          content.querySelectorAll('[data-ai-sentence-copy]').forEach((button) => {
            button.onclick = async () => {
              if (!current()) return;
              const text = sentences.get(button.dataset.aiSentenceCopy);
              if (!text) return;
              const copied = await copyText(text);
              if (current()) toast(copied ? '✓ 已复制' : '未能复制，请长按句子选择文字复制');
            };
          });
        }
        refreshSpeech(modal);
      } catch (error) {
        if (!current()) return;
        const message =
          error instanceof AIError ? error.message : 'AI老师这次的回复不完整，请再试一次。';
        content.innerHTML = '<p role="alert">' + e(message) + '</p>';
        if (error instanceof AIError && error.retryAfterSeconds)
          startCooldown(error.retryAfterSeconds);
        session.failed = true;
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
  if (getContextKey) {
    const invalidate = (event) => {
      if (!active || active.contextKey === getContextKey()) return;
      active.dispose();
      const modal = document.querySelector('#modal');
      if (modal?.open && modal.classList.contains('ai-dialog')) {
        // Keep the student's editing/composition focus when closing stale help.
        if (event.target instanceof HTMLElement && event.target.matches('input, textarea, select'))
          modal.__returnFocus = event.target;
        closeModal();
      }
    };
    for (const type of ['input', 'change', 'sentence-teacher-context-change'])
      root.addEventListener(type, invalidate, { signal });
  }
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
