import { escapeHTML as e, highlight, normalize, toast } from '../js/utils.js';
import { copyText } from '../js/clipboard.js';
import { SENTENCE_SCENARIO_GROUPS, CUSTOM_SENTENCE_SCENARIO } from '../data/sentence-scenarios.js';
import { builders, practiceExample } from '../data/content.js';
import { productionEligible } from '../js/writing-checks.js';
import { state, persist } from '../js/state.js';
import { enableDrag } from '../components/drag.js';
import { aiToolbar, attachAITeacher } from '../components/ai-teacher.js';
import { TUTOR_ACTION as A, TUTOR_ACTIVITY } from '../js/tutor-actions.js';
import { sentenceVocabularyCandidates } from '../js/ai-vocabulary.js';
import { MAX_KEYWORD_LENGTH, keywordReminder } from '../js/sentence-keyword.js';
import { buildSentenceTeacherContext } from '../js/sentence-teacher-context.js';

const scenarioOptions = () => SENTENCE_SCENARIO_GROUPS.map(({ label, options }) => `<optgroup label="${e(label)}">${options.map((text) => `<option>${e(text)}</option>`).join('')}</optgroup>`).join('') + `<option>${e(CUSTOM_SENTENCE_SCENARIO)}</option>`;
const scenarioFields = () => `<label for="sentence-context">我想写的情境</label><select id="sentence-context" class="sentence-scenario-select">${scenarioOptions()}</select>`;

function connectSentenceTeacher(root, ctx, draftKey, getSentence) {
  const restoreScenario = () => {
    const situation = root.querySelector('#sentence-context');
    if (!root.querySelector('#custom-sentence-context'))
      situation.insertAdjacentHTML('afterend', '<label id="custom-sentence-context-label" hidden>我的情境<input id="custom-sentence-context" maxlength="240" placeholder="例如：运动会接力赛"></label>');
    situation.value = state.drafts[draftKey]?.situation || situation.options[0].value;
    root.querySelector('#custom-sentence-context').value = state.drafts[draftKey]?.customSituation || '';
    root.querySelector('#custom-sentence-context-label').hidden = situation.value !== CUSTOM_SENTENCE_SCENARIO;
  };
  restoreScenario();
  const saveScenario = (event) => {
    if (!event.target.matches('#sentence-context, #custom-sentence-context')) return;
    const situation = root.querySelector('#sentence-context');
    root.querySelector('#custom-sentence-context-label').hidden = situation.value !== CUSTOM_SENTENCE_SCENARIO;
    state.drafts[draftKey] = { ...state.drafts[draftKey], text: getSentence(), word: ctx.item.word,
      kind: state.drafts[draftKey]?.kind || 'sentence', situation: situation.value,
      customSituation: root.querySelector('#custom-sentence-context').value, at: new Date().toISOString() };
    persist();
  };
  root.addEventListener('change', saveScenario, { signal: ctx.signal });
  root.addEventListener('input', saveScenario, { signal: ctx.signal });
  const getContext = () => buildSentenceTeacherContext({
    activeKeyword: ctx.activeKeyword?.() || ctx.item.word,
    keywordMode: ctx.keywordMode?.() || 'builtin',
    situation: root.querySelector('#sentence-context').value,
    customSituation: root.querySelector('#custom-sentence-context').value,
    studentSentence: getSentence(),
    studentYearLevel: state.settings.grade === 'mixed' ? ctx.studentYearLevel || ctx.item.grade : state.settings.grade,
  });
  attachAITeacher(root, { signal: ctx.signal, getContextKey: () => JSON.stringify(getContext()), getRequest(action) {
    const context = getContext();
    return { activity: TUTOR_ACTIVITY.SENTENCE, context: {
      ...context,
      availableVocabularyIds: action === A.VOCABULARY_HELP
        ? sentenceVocabularyCandidates(context.situation, context.topic, context.studentYearLevel || state.settings.grade, context.studentSentence) : [],
    } };
  } });
  return restoreScenario;
}
export function freeSentence(root, ctx) {
  const key = ctx.sentenceDraftKey || `sentence:${ctx.item.id}`,
    saved = state.drafts[key]?.text || '';
  const isBuilder = ctx.activity?.id === 'builder';
  const situations = ['在学校', '和家人相处', '与朋友一起', CUSTOM_SENTENCE_SCENARIO];
  // Keep the platform's native, viewport-bounded picker and its keyboard/touch UI.
  const situationOptions = isBuilder
    ? scenarioOptions()
    : situations.map((text) => `<option>${e(text)}</option>`).join('');
  root.innerHTML = `<h2>轮到你来造句</h2><div class="target-word">${e(ctx.item.word)}</div><p class="question-instruction">想想谁在什么地方，做了什么。用这个词语，写一句发生在生活中的话。</p><details class="reference-details" ${ctx.difficulty === 'easy' ? 'open' : ''}><summary>看看参考用法</summary><p class="quote">${highlight(practiceExample(ctx.item), [ctx.item.word])}</p></details><label for="sentence-context">我想写的情境</label><select id="sentence-context" ${isBuilder ? 'class="sentence-scenario-select"' : ''}>${situationOptions}</select><label for="own-sentence" style="margin-top:16px">我的句子</label><textarea id="own-sentence" placeholder="把人物、事情和想法写清楚。">${e(saved)}</textarea>${isBuilder ? `<div class="action-bar sentence-copy-actions"><button type="button" class="btn" id="copy-sentence" ${saved.trim() ? '' : 'disabled'}><span aria-hidden="true">📋</span> 复制句子</button></div>` : ''}<p class="save-status" id="sentence-save">草稿保存在这台设备</p><div class="check-row"><input type="checkbox" id="sentence-selfcheck"><label for="sentence-selfcheck">我读过一遍，确认词语用在真实的情境里。</label></div><button class="btn primary" id="submit-sentence">记录我的造句练习</button><p class="source-label">自动检查只检查用词、字数与标点。句意和用法请和老师一起读一读。</p>`;
  const input = root.querySelector('#own-sentence');
  if (ctx.item.custom) root.querySelector('.reference-details').remove();
  const selfcheck = root.querySelector('#sentence-selfcheck');
  if (isBuilder) selfcheck.checked = !!state.drafts[key]?.selfcheck;
  if (isBuilder) selfcheck.addEventListener('change', () => {
    state.drafts[key] = { ...state.drafts[key], text: input.value, word: ctx.item.word, kind: 'sentence', selfcheck: selfcheck.checked, at: new Date().toISOString() };
    persist();
  }, { signal: ctx.signal });
  if (isBuilder) {
    root.insertAdjacentHTML('beforeend', aiToolbar(TUTOR_ACTIVITY.SENTENCE));
    connectSentenceTeacher(root, ctx, key, () => input.value);
  }
  const copy = root.querySelector('#copy-sentence');
  copy?.addEventListener('click', async () => {
    if (!input.value.trim()) return;
    const copied = await copyText(input.value);
    toast(copied ? '句子已复制' : '未能复制，请长按句子选择文字复制');
  }, { signal: ctx.signal });
  input.addEventListener(
    'input',
    (event) => {
      if (copy) copy.disabled = !event.target.value.trim();
      state.drafts[key] = {
        ...state.drafts[key],
        text: event.target.value,
        word: ctx.item.word,
        at: new Date().toISOString(),
        kind: 'sentence',
      };
      const ok = persist();
      root.querySelector('#sentence-save').textContent = ok
        ? '✓ 草稿已保存'
        : '尚未保存，请复制句子';
    },
    { signal: ctx.signal },
  );
  root.querySelector('#submit-sentence').addEventListener(
    'click',
    () => {
      const text = root.querySelector('#own-sentence').value.trim();
      if (isBuilder && !text.includes(ctx.item.word)) {
        ctx.note(keywordReminder(ctx.item.word));
        return;
      }
      if (!productionEligible(text, ctx.item.word)) {
        ctx.note('请把这个词语写进一个具体情境，写清楚事情，并加上句末标点。');
        return;
      }
      if (normalize(text) === normalize(practiceExample(ctx.item))) {
        ctx.note('这是参考句。请换一个人物、事情或情境，写出自己的句子。');
        return;
      }
      if (!root.querySelector('#sentence-selfcheck').checked) {
        ctx.note('先读一读自己的句子，再勾选自查。');
        return;
      }
      ctx.complete({
        kind: 'sentence',
        answer: text,
        message: '已记录你的自主造句练习。请把句子读给老师或家人听，看看词语用得是否自然。',
      });
    },
    { signal: ctx.signal },
  );
}
export function sentenceBuilder(root, ctx) {
  const preferencesKey = 'builder:keyword-settings';
  const preferences = state.drafts[preferencesKey] ||= { text: '', mode: 'builtin', customInput: '', customKeyword: '' };
  let mode = preferences.mode === 'custom' ? 'custom' : 'builtin';
  let customKeyword = preferences.customKeyword || '';
  // This getter is the sole authority for workspace, helper and AI targets.
  const activeKeyword = () => mode === 'builtin' ? ctx.item.word : customKeyword;
  let workspaceController;
  root.innerHTML = `<fieldset class="keyword-modes"><legend>选择词语方式</legend><div class="keyword-mode-options"><button type="button" class="btn" data-keyword-mode="builtin">📚 内置词语</button><button type="button" class="btn" data-keyword-mode="custom">✏️ 自选词语</button></div></fieldset><form id="custom-keyword-form" hidden><label for="custom-keyword">请输入你想练习的词语</label><div class="custom-keyword-controls"><input id="custom-keyword" maxlength="${MAX_KEYWORD_LENGTH}" placeholder="例如：坚持、保护环境、兴高采烈" aria-describedby="custom-keyword-error"><button class="btn primary" type="submit">开始造句</button></div><p class="small muted">可输入词语、成语或短语，最多 ${MAX_KEYWORD_LENGTH} 字符。</p><p id="custom-keyword-error" role="alert" hidden></p></form><section class="sentence-target" aria-live="polite"><strong>本次造句词语：</strong><mark id="active-keyword"></mark><p id="keyword-instruction"></p></section><div id="sentence-workspace"></div>`;
  const input = root.querySelector('#custom-keyword');
  const error = root.querySelector('#custom-keyword-error');
  const workspace = root.querySelector('#sentence-workspace');
  input.value = preferences.customInput || '';
  let composing = false;
  input.addEventListener('compositionstart', () => { composing = true; }, { signal: ctx.signal });
  input.addEventListener('compositionend', () => { composing = false; }, { signal: ctx.signal });
  input.addEventListener('input', () => {
    preferences.customInput = input.value;
    error.hidden = true;
    input.removeAttribute('aria-invalid');
    persist();
  }, { signal: ctx.signal });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (composing || event.isComposing || event.keyCode === 229)) event.preventDefault();
  }, { signal: ctx.signal });
  ctx.activeKeyword = activeKeyword;
  ctx.keywordMode = () => mode;
  const drawWorkspace = () => {
    workspaceController?.abort(); // Discard old requests, dialogs and event handlers.
    workspaceController = new AbortController();
    ctx.finished = false;
    ctx.reset = undefined;
    for (const id of ['activity-feedback', 'activity-complete', 'hint-output']) {
      const element = root.closest('.question-card')?.querySelector(`#${id}`);
      if (element) element.hidden = true;
    }
    root.querySelectorAll('[data-keyword-mode]').forEach((button) => {
      const selected = mode === button.dataset.keywordMode;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('primary', selected);
    });
    root.querySelector('#custom-keyword-form').hidden = mode !== 'custom';
    const keyword = activeKeyword();
    root.querySelector('#active-keyword').textContent = keyword || '请先输入词语';
    root.querySelector('#keyword-instruction').textContent = keyword ? `请用“${keyword}”造一个完整、通顺的句子。` : '确认词语后，就可以开始造句。';
    workspace.replaceChildren();
    if (!keyword) return;
    const child = Object.create(ctx);
    child.signal = workspaceController.signal;
    child.item = mode === 'builtin' ? ctx.item : { word: keyword, custom: true };
    child.studentYearLevel = ctx.item.grade;
    child.complete = (result) => {
      if (mode === 'custom') {
        state.drafts[child.sentenceDraftKey] = {
          ...state.drafts[child.sentenceDraftKey], practicedAt: new Date().toISOString(),
        };
        persist();
      }
      ctx.complete(mode === 'builtin' ? result : { ...result, items: [] });
      child.finished = ctx.finished;
    };
    if (mode === 'custom') {
      child.sentenceDraftKey = `sentence:custom:${encodeURIComponent(keyword)}`;
      freeSentence(workspace, child);
    } else builtInSentenceBuilder(workspace, child);
    ctx.reset = child.reset;
    preferences.mode = mode;
    preferences.customKeyword = customKeyword;
    persist();
  };
  root.querySelectorAll('[data-keyword-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      if (mode === button.dataset.keywordMode) return;
      mode = button.dataset.keywordMode;
      preferences.mode = mode;
      persist();
      drawWorkspace();
    }, { signal: ctx.signal });
  });
  root.querySelector('#custom-keyword-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (composing) return;
    const keyword = input.value.trim();
    if (!keyword || keyword.length > MAX_KEYWORD_LENGTH) {
      error.textContent = !keyword ? '请先输入你想练习的词语。' : `词语太长了，请控制在 ${MAX_KEYWORD_LENGTH} 字符以内。`;
      error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    input.value = keyword;
    preferences.customInput = keyword;
    if (customKeyword !== keyword) {
      customKeyword = keyword;
      drawWorkspace();
    }
    persist();
  }, { signal: ctx.signal });
  ctx.signal.addEventListener('abort', () => workspaceController?.abort(), { once: true });
  drawWorkspace();
}

function builtInSentenceBuilder(root, ctx) {
  const data = builders[ctx.item.word];
  if (!data || ctx.difficulty === 'hard' || ctx.params.get('mode') === 'free') {
    freeSentence(root, ctx);
    return;
  }
  const groups = [
    ['when', '什么时候'],
    ['who', '谁'],
    ['event', '事情 / 动作'],
    ['action', '结果 / 感受'],
  ];
  const draftKey = `builder:${ctx.item.id}`;
  const selected = Object.fromEntries(
    groups.flatMap(([key]) => {
      const index = state.drafts[draftKey]?.blocks?.[key];
      return Number.isInteger(index) && index >= 0 && index < data[key].length ? [[key, index]] : [];
    }),
  );
  ctx.reset = () => {
    delete state.drafts[draftKey];
    persist();
  };
  const sentence = () =>
    groups.every(([k]) => selected[k] !== undefined)
      ? `${data.when[selected.when]}，${data.who[selected.who]}${data.event[selected.event]}${data.action[selected.action]}。`
      : '';
  let restoreScenario;
  function draw() {
    root.innerHTML = `<h2>用积木，搭出不同的句子</h2><div class="row"><div class="target-word">${e(ctx.item.word)}</div><span class="pill">每组选择一块</span></div><p class="question-instruction">点选积木，或把积木拖进下面的句子区。换一种组合，也能说得通。</p><div class="build-groups">${groups.map(([key, label]) => `<section class="build-group"><h3>${label}</h3><div class="chip-tray">${data[key].map((text, i) => `<button class="word-chip tile ${selected[key] === i ? 'selected' : ''}" data-part="${key}:${i}" data-drag="${key}:${i}" aria-pressed="${selected[key] === i}">${e(text)}</button>`).join('')}</div></section>`).join('')}</div><div class="sentence-display" data-drop="sentence" aria-live="polite">${sentence() ? highlight(sentence(), [ctx.item.word]) : '选好四组积木，看看你的句子。'}</div><div class="action-bar"><button class="btn primary" id="finish-builder" ${sentence() ? '' : 'disabled'}>读读我的句子</button><a class="btn" href="#activity/builder?word=${encodeURIComponent(ctx.item.id)}&mode=free">挑战：自己写一句</a></div>${aiToolbar(TUTOR_ACTIVITY.SENTENCE)}`;
    root.querySelector('.ai-toolbar').insertAdjacentHTML('beforebegin', scenarioFields());
    restoreScenario?.();
  }
  function choose(value) {
    if (ctx.finished) return;
    const [key, index] = value.split(':');
    if (!groups.some(([part]) => part === key) || !Number.isInteger(Number(index)) || !data[key][Number(index)]) return;
    selected[key] = Number(index);
    state.drafts[draftKey] = { ...state.drafts[draftKey], text: sentence(), blocks: { ...selected }, word: ctx.item.word, kind: 'builder', at: new Date().toISOString() };
    persist();
    root.dispatchEvent(new Event('sentence-teacher-context-change'));
    draw();
  }
  draw();
  restoreScenario = connectSentenceTeacher(root, ctx, draftKey, sentence);
  enableDrag(
    root,
    (id, target) => {
      if (target === 'sentence') choose(id);
    },
    ctx.signal,
  );
  root.addEventListener(
    'click',
    (event) => {
      const part = event.target.closest('[data-part]');
      if (part) choose(part.dataset.part);
      if (event.target.closest('#finish-builder') && sentence())
        ctx.complete({
          kind: 'guided',
          answer: sentence(),
          message: `${data.why} 你还可以怎样说？试着写出自己的第二句。`,
        });
    },
    { signal: ctx.signal },
  );
}
