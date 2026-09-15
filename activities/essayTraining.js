import { escapeHTML as e, $, $$, toast } from '../js/utils.js';
import { state, persist, vocabulary } from '../js/state.js';
import { getEssayTitles } from '../js/essay-title-service.js';
import { getActiveEssayContentsByEssayId } from '../js/essay-content-service.js';
import { countCompositionCharacters } from '../js/writing-checks.js';
import { deriveEssayTraining, writingLengthGuidance } from '../js/essay-training-service.js';
import { resolveReferenceParagraph, splitChineseSentences } from '../js/essay-sentence-service.js';
import { enhanceSpeechUI, stop } from '../js/speech-service.js';
import { openVocabularyDialog } from '../components/vocabulary-dialog.js';
import { copyText as copyEssayText } from '../js/clipboard.js';
// Preserve the existing export for callers and essay-copy regression tests.
export { copyEssayText };

const gradeName = ['一', '二', '三', '四', '五', '六'];
const values = (records, key) =>
  [...new Set(records.map((record) => record[key]).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), 'zh-Hans'),
  );
const paragraphHTML = (paragraph) =>
  `<p class="model-paragraph">${splitChineseSentences(paragraph.text)
    .map((sentence) => `<span class="essay-sentence" data-essay-sentence>${e(sentence)}</span>`)
    .join('')}</p>`;
const topicInfo = (topic, content) =>
  `<span class="pill">${gradeName[topic.gradeMin - 1]}年级</span><span class="pill">${e(topic.category)}</span><span class="pill">难度 ${e(topic.difficulty)}</span><span class="small muted">约 ${content.wordCount} 字</span>`;

function TopicPicker({ topics, catalog = topics, selectedId, filters }) {
  const select = (key, label, options) =>
    `<label>${label}<select data-training-filter="${key}"><option value="">全部</option>${options.map((value) => `<option value="${e(value)}" ${filters[key] === String(value) ? 'selected' : ''}>${e(value)}</option>`).join('')}</select></label>`;
  return `<section class="essay-topic-picker panel soft training-picker"><div class="row between"><strong>选择作文题目</strong><span class="small muted">${topics.length} 个有范文的题目</span></div><label>搜索题目<input type="search" data-training-filter="search" value="${e(filters.search)}" placeholder="搜索题目、主题或关键词"></label><div class="training-filters">${select('grade', '年级', [1, 2, 3, 4, 5, 6])}${select('category', '类别', values(catalog, 'category'))}${select('theme', '主题', values(catalog, 'theme'))}${select('essayType', '作文类型', values(catalog, 'essayType'))}${select('difficulty', '难度', values(catalog, 'difficulty'))}</div><label>题目<select id="training-topic" ${topics.length ? '' : 'disabled'}>${topics.length ? topics.map((topic) => `<option value="${e(topic.id)}" ${topic.id === selectedId ? 'selected' : ''}>《${e(topic.title)}》 · ${e(topic.category)}</option>`).join('') : '<option>没有符合条件的题目</option>'}</select></label></section>`;
}

const allModelTopics = () =>
  getEssayTitles().filter((topic) => getActiveEssayContentsByEssayId(topic.id).length);

function filteredTopics(filters) {
  const query = filters.search.trim().toLowerCase();
  return getEssayTitles({
    grade: filters.grade || undefined,
    category: filters.category || undefined,
    theme: filters.theme || undefined,
    essayType: filters.essayType || undefined,
    difficulty: filters.difficulty || undefined,
  }).filter((topic) => {
    if (!getActiveEssayContentsByEssayId(topic.id).length) return false;
    if (!query) return true;
    return [topic.title, topic.category, topic.theme, ...(topic.suggestedKeywords || [])]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });
}

function knownWords(text) {
  return vocabulary.filter((word) => word.word.length > 1 && text.includes(word.word)).slice(0, 12);
}

export function modelEssayStudy(root, ctx) {
  let filters = { grade: '', category: '', theme: '', essayType: '', difficulty: '', search: '' };
  let topics = filteredTopics(filters);
  let topic = topics.find((item) => item.id === ctx.params.get('topic')) || topics[0];
  let contentId =
    ctx.params.get('content') || getActiveEssayContentsByEssayId(topic?.id)[0]?.contentId;
  let selectedParagraph = 0;
  const draw = () => {
    topics = filteredTopics(filters);
    if (!topics.some((item) => item.id === topic?.id)) topic = topics[0];
    const contents = getActiveEssayContentsByEssayId(topic?.id);
    let content = contents.find((item) => item.contentId === contentId) || contents[0];
    contentId = content?.contentId;
    if (!topic || !content) {
      root.innerHTML = `<h2>范文学习</h2>${TopicPicker({ topics, catalog: allModelTopics(), selectedId: '', filters })}<div class="empty-state"><h3>没有符合条件的题目</h3><p>请调整筛选条件，或清除搜索文字后再试。</p></div>`;
      return;
    }
    stop();
    const training = deriveEssayTraining(content, topic);
    selectedParagraph = Math.min(selectedParagraph, training.paragraphs.length - 1);
    const paragraph = training.paragraphs[selectedParagraph];
    const words = knownWords(paragraph.text);
    root.innerHTML = `<h2>范文学习</h2><p class="question-instruction">先读一读，再点选段落，看看每一段怎样帮助文章变得完整。</p>${TopicPicker({ topics, catalog: allModelTopics(), selectedId: topic.id, filters })}<section class="panel model-study-heading"><div><h3>《${e(topic.title)}》</h3><div class="row wrap">${topicInfo(topic, content)}</div></div>${contents.length > 1 ? `<label>范文版本<select id="model-content">${contents.map((item) => `<option value="${e(item.contentId)}" ${item.contentId === contentId ? 'selected' : ''}>${e(item.contentTitle || item.version)} · ${e(item.level)}</option>`).join('')}</select></label>` : ''}</section><div class="model-study-layout"><section class="panel model-reading" aria-label="参考范文"><p class="small muted">参考范文 · ${training.paragraphCount} 段</p>${training.paragraphs.map((item, index) => `<button class="model-paragraph-button ${index === selectedParagraph ? 'selected' : ''}" data-model-paragraph="${index}" aria-pressed="${index === selectedParagraph}"><span>${e(item.label)}</span>${paragraphHTML(item)}</button>`).join('')}</section><aside class="panel soft paragraph-learning" aria-live="polite"><span class="eyebrow">${e(paragraph.label)}</span><h3>这一段写什么？</h3><p>${e(paragraph.role)}</p><h4>重要意思</h4><ul>${paragraph.keyPoints.map((point) => `<li>${e(point)}</li>`).join('')}</ul><h4>句子写得好在哪里？</h4><p class="sentence-sample">${e(paragraph.representativeSentence)}</p>${words.length ? `<h4>文中词语</h4><div class="chip-tray">${words.map((word) => `<button class="word-chip" data-word-card="${e(word.id)}">${e(word.word)}</button>`).join('')}</div><p class="small muted">点词可查看词语库中已有的资料。</p>` : ''}</aside></div>`;
    enhanceSpeechUI(root);
  };
  draw();
  root.addEventListener('change', () => stop(), { signal: ctx.signal });
  root.addEventListener(
    'change',
    (event) => {
      if (event.target.dataset.trainingFilter) {
        filters[event.target.dataset.trainingFilter] = event.target.value;
        selectedParagraph = 0;
        draw();
        return;
      }
      if (event.target.id === 'training-topic') {
        topic = getEssayTitles({ active: null }).find((item) => item.id === event.target.value);
        contentId = null;
        selectedParagraph = 0;
        draw();
      }
      if (event.target.id === 'model-content') {
        contentId = event.target.value;
        selectedParagraph = 0;
        draw();
      }
    },
    { signal: ctx.signal },
  );
  root.addEventListener(
    'input',
    (event) => {
      if (event.target.dataset.trainingFilter === 'search') {
        filters.search = event.target.value;
        selectedParagraph = 0;
        draw();
      }
    },
    { signal: ctx.signal },
  );
  root.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest('[data-model-paragraph]');
      if (button) {
        selectedParagraph = Number(button.dataset.modelParagraph);
        draw();
      }
    },
    { signal: ctx.signal },
  );
}

export function guidedEssayWriting(root, ctx) {
  let filters = {
    grade: String(Number(state.settings.grade) || 3),
    category: '',
    theme: '',
    essayType: '',
    difficulty: '',
    search: '',
  };
  let topics = filteredTopics(filters);
  let topic = topics.find((item) => item.id === ctx.params.get('topic')) || topics[0];
  let contentId =
    ctx.params.get('content') || getActiveEssayContentsByEssayId(topic?.id)[0]?.contentId;
  let activeParagraph = 0,
    focusedTextarea = null,
    saveTimer;
  let draft;
  const loadDraft = (content, training) => {
    const key = `guided-essay:${content.contentId}`;
    draft = state.drafts[key] || {
      text: '',
      lines: Array(training.paragraphCount).fill(''),
      checklist: {},
      helpLevel: 1,
      reveal: false,
      kind: 'essay',
      title: topic.title,
      contentId: content.contentId,
    };
    draft.lines = Array.from(
      { length: training.paragraphCount },
      (_, index) => draft.lines?.[index] || '',
    );
    draft.checklist ||= {};
    draft.helpLevel ||= 1;
    draft.key = key;
  };
  const syncDraftText = () => {
    draft.text = draft.lines.filter(Boolean).join('\n\n');
  };
  const save = () => {
    syncDraftText();
    draft.at = new Date().toISOString();
    state.drafts[draft.key] = draft;
    persist();
  };
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      save();
    }, 400);
  };
  const draw = () => {
    topics = filteredTopics(filters);
    if (!topics.some((item) => item.id === topic?.id)) topic = topics[0];
    const contents = getActiveEssayContentsByEssayId(topic?.id);
    const content = contents.find((item) => item.contentId === contentId) || contents[0];
    contentId = content?.contentId;
    if (!topic || !content) {
      root.innerHTML = `<h2>要点导写</h2>${TopicPicker({ topics, catalog: allModelTopics(), selectedId: '', filters })}<div class="empty-state"><h3>没有符合条件的题目</h3><p>请调整筛选条件，或清除搜索文字后再试。</p></div>`;
      return;
    }
    const training = deriveEssayTraining(content, topic);
    loadDraft(content, training);
    activeParagraph = Math.min(activeParagraph, training.paragraphCount - 1);
    const item = training.paragraphs[activeParagraph],
      count = countCompositionCharacters(draft.text);
    const keywordPanel =
      draft.helpLevel >= 2
        ? `<section class="hint-card"><h4>关键词</h4><div class="chip-tray">${[
            ...new Set([...topic.suggestedKeywords, ...item.keywords]),
          ]
            .slice(0, 8)
            .map((word) => `<span class="word-chip">${e(word)}</span>`)
            .join('')}</div></section>`
        : '';
    const pointPanel =
      draft.helpLevel >= 3
        ? `<section class="hint-card"><h4>写作要点</h4><ul>${item.keyPoints.map((point) => `<li>${e(point)}</li>`).join('')}</ul></section>`
        : '';
    const cuePanel =
      draft.helpLevel >= 4
        ? `<section class="hint-card"><h4>句子提示</h4><button class="sentence-starter" data-starter="${e(item.sentenceCue)}">${e(item.sentenceCue)}</button><p class="small muted">点一下可放进当前段落，再改成自己的内容。</p></section>`
        : '';
    const referenceParagraph = resolveReferenceParagraph(content.content, {
      paragraphIndex: item.paragraphIndex,
      referenceSentence: item.representativeSentence,
    });
    const examplePanel =
      draft.helpLevel >= 5
        ? `<section class="hint-card example-hint"><h4>范句（参考后请用自己的内容写）</h4><p class="example-hint-text">${e(referenceParagraph)}</p></section>`
        : '';
    root.innerHTML = `<h2>要点导写</h2><p class="question-instruction">参考要点，用自己的内容来写。完整范文会在你尝试后才显示。</p>${TopicPicker({ topics, catalog: allModelTopics(), selectedId: topic.id, filters })}<section class="guided-topic panel"><div><h3>《${e(topic.title)}》</h3><div class="row wrap">${topicInfo(topic, content)}</div></div>${contents.length > 1 ? `<label>难度/版本<select id="guided-content">${contents.map((entry) => `<option value="${e(entry.contentId)}" ${entry.contentId === contentId ? 'selected' : ''}>${e(entry.contentTitle || entry.version)} · ${e(entry.level)}</option>`).join('')}</select></label>` : ''}<p>${e(topic.writingGuidance.join('、') || '先想清楚，再按顺序写。')}</p></section><section class="panel soft guided-think"><h3>第一步：想一想</h3><ul>${training.writingQuestions.map((question) => `<li>${e(question)}</li>`).join('')}</ul></section><div class="guided-layout"><section class="panel guided-editor"><div class="guided-steps">${training.paragraphs.map((paragraph, index) => `<button data-guided-paragraph="${index}" class="${index === activeParagraph ? 'active' : ''}" aria-current="${index === activeParagraph ? 'step' : 'false'}">${index + 1}. ${e(paragraph.label)}</button>`).join('')}</div><h3>第${activeParagraph + 1}段：${e(item.label)}</h3><p class="muted">${e(item.role)}</p><div class="row between"><label for="guided-line">我的这一段</label><button type="button" class="btn" id="guided-vocabulary" aria-haspopup="dialog" aria-controls="modal">词语库</button></div><textarea id="guided-line" class="guided-line" placeholder="用自己的经历来写，不必照抄范文。">${e(draft.lines[activeParagraph])}</textarea><div class="row between"><span id="guided-line-count" class="small muted">这一段 ${countCompositionCharacters(draft.lines[activeParagraph])} 字</span><button id="guided-next" class="btn primary">${activeParagraph === training.paragraphCount - 1 ? '完成作文 →' : '完成这一段 →'}</button></div></section><aside class="guided-help"><section class="panel soft"><h3>给我一点提示</h3><p class="small muted">第 ${draft.helpLevel} / 5 层提示。你可以按自己的需要停下来。</p><div class="action-bar"><button class="btn" id="guided-more-help" ${draft.helpLevel >= 5 ? 'disabled' : ''}>${draft.helpLevel === 1 ? '看关键词' : draft.helpLevel === 2 ? '看写作要点' : draft.helpLevel === 3 ? '看句子提示' : '看范句'}</button></div>${keywordPanel}${pointPanel}${cuePanel}${examplePanel}</section><section class="panel sentence-starters"><h3>常用句子开头</h3>${training.sentenceStarters.map((starter) => `<button class="sentence-starter" data-starter="${e(starter.replace('……', ''))}">${e(starter)}</button>`).join('')}</section></aside></div><section class="panel complete-essay"><div class="row between"><div><h3>我的作文</h3><p class="small muted">当前字数：<strong id="guided-total-count">${count}</strong> · ${writingLengthGuidance(count)}</p></div><div class="row guided-essay-actions"><button type="button" class="btn" id="guided-copy" aria-label="复制全文" ${draft.text ? '' : 'disabled'}>复制全文</button><button type="button" class="btn" id="guided-reset">重新开始</button></div></div><div class="writing-preview" id="guided-preview">${e(draft.text || '完成每一段后，这里会合成你的作文。')}</div></section><section class="panel self-assess"><h3>作文小检查</h3>${['我有写清楚人物或事情。', '我有分段。', '事情有开始、经过和结果。', '我用了完整句子。', '我写了自己的感受。', '我检查了错别字。', '我的结尾完整。'].map((label, index) => `<div class="check-row"><input id="guided-check-${index}" data-guided-check="${index}" type="checkbox" ${draft.checklist[index] ? 'checked' : ''}><label for="guided-check-${index}">${label}</label></div>`).join('')}</section><section class="model-reveal panel ${draft.reveal ? 'revealed' : ''}"><div class="row between"><div><h3>参考范文</h3><p class="small muted">先看自己的作文，再比较开头、段落顺序和表达方式。</p></div><button class="btn ${draft.reveal ? '' : 'primary'}" id="guided-reveal">${draft.reveal ? '收起范文' : '完成后查看范文'}</button></div>${draft.reveal ? `<div class="comparison-grid"><article><h4>我的作文</h4><div class="writing-preview">${e(draft.text || '还没有写内容。')}</div></article><article><h4>参考范文</h4>${training.paragraphs.map(paragraphHTML).join('')}</article></div>` : ''}</section>`;
  };
  enhanceSpeechUI(root);
  const saveLine = (immediate = true) => {
    if (!draft) return;
    draft.lines[activeParagraph] = $('#guided-line', root)?.value || '';
    syncDraftText();
    if (immediate) save();
  };
  draw();
  ctx.save = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      save();
    }
  };
  ctx.signal?.addEventListener('abort', ctx.save, { once: true });
  root.addEventListener('change', () => stop(), { signal: ctx.signal });
  root.addEventListener(
    'input',
    (event) => {
      if (event.target.dataset.trainingFilter === 'search') {
        filters.search = event.target.value;
        activeParagraph = 0;
        draw();
        return;
      }
      if (event.target.id === 'guided-line') {
        focusedTextarea = event.target;
        saveLine(false);
        scheduleSave();
        $('#guided-line-count', root).textContent =
          `这一段 ${countCompositionCharacters(event.target.value)} 字`;
        $('#guided-total-count', root).textContent = countCompositionCharacters(draft.text);
        $('#guided-preview', root).textContent = draft.text || '完成每一段后，这里会合成你的作文。';
        $('#guided-copy', root).disabled = !draft.text;
      }
    },
    { signal: ctx.signal },
  );
  root.addEventListener(
    'change',
    (event) => {
      if (event.target.dataset.trainingFilter) {
        filters[event.target.dataset.trainingFilter] = event.target.value;
        activeParagraph = 0;
        draw();
        return;
      }
      if (event.target.id === 'training-topic') {
        topic = getEssayTitles({ active: null }).find((item) => item.id === event.target.value);
        contentId = null;
        activeParagraph = 0;
        draw();
      }
      if (event.target.id === 'guided-content') {
        contentId = event.target.value;
        activeParagraph = 0;
        draw();
      }
      if (event.target.dataset.guidedCheck) {
        draft.checklist[event.target.dataset.guidedCheck] = event.target.checked;
        save();
      }
    },
    { signal: ctx.signal },
  );
  root.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.id === 'guided-vocabulary') {
        openVocabularyDialog({ signal: ctx.signal });
        return;
      }
      if (button.dataset.guidedParagraph) {
        saveLine();
        activeParagraph = Number(button.dataset.guidedParagraph);
        draw();
        return;
      }
      if (button.id === 'guided-more-help') {
        draft.helpLevel = Math.min(5, draft.helpLevel + 1);
        save();
        draw();
        return;
      }
      if (button.dataset.starter != null) {
        const field = focusedTextarea || $('#guided-line', root);
        const starter = button.dataset.starter;
        const start = field.selectionStart ?? field.value.length;
        field.value =
          field.value.slice(0, start) + starter + field.value.slice(field.selectionEnd ?? start);
        focusedTextarea = field;
        field.focus();
        saveLine();
        $('#guided-line-count', root).textContent =
          `这一段 ${countCompositionCharacters(field.value)} 字`;
        $('#guided-total-count', root).textContent = countCompositionCharacters(draft.text);
        $('#guided-preview', root).textContent = draft.text;
        return;
      }
      if (button.id === 'guided-next') {
        saveLine();
        if (activeParagraph < draft.lines.length - 1) {
          activeParagraph += 1;
          draw();
        } else {
          $('#guided-preview', root)?.scrollIntoView({ block: 'center' });
        }
        return;
      }
      if (button.id === 'guided-reveal') {
        draft.reveal = !draft.reveal;
        save();
        draw();
        return;
      }
      if (button.id === 'guided-copy') {
        saveLine();
        copyEssayText(draft.text).then((copied) =>
          toast(copied ? '作文已复制' : '暂时无法复制，请重试'),
        );
        return;
      }
      if (button.id === 'guided-reset') {
        draft.lines = draft.lines.map(() => '');
        draft.reveal = false;
        save();
        draw();
      }
    },
    { signal: ctx.signal },
  );
}
