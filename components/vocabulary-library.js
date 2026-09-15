import { vocabulary, changeLocalVocabulary, resetLocalVocabulary } from '../js/state.js';
import { backButton } from '../js/navigation.js';
import { vocabularyService } from '../js/vocabulary-service.js';
import { fields, listFields, previewRows, applyImport } from '../js/vocabulary-schema.js';
import { exportRecords, libraryStatus, localLibraryNotice } from '../js/vocabulary-store.js';
import { escapeHTML as e, $, download, prettyGrade } from '../js/utils.js';
import { showModal, closeModal, confirmAction } from './modal.js';

const labels = {
  id: '编号 ID',
  word: '词语 *',
  grade: '年级 *',
  pinyin: '拼音',
  meaningEnglish: '英文意思',
  meaningMalay: '马来文意思',
  partOfSpeech: '词性',
  category: '类别',
  difficulty: '难度 1–3',
  exampleSentence: '例句（保留原文）',
  sentencePinyin: '例句拼音',
  synonyms: '近义词',
  antonyms: '反义词',
  collocations: '搭配',
  essayTopics: '作文主题',
  tags: '标签',
  source: '来源',
  character: '来源生字（可选）',
  lesson: '课次',
  generatedSynonyms: '生成近义词',
  definitionChinese: '中文释义',
};
export function manageVocabulary(root) {
  let page = 0,
    query = '',
    sort = 'word',
    direction = 1,
    filters = {},
    preview = null,
    importPage = 0,
    problems = false,
    worker = null,
    disposed = false;
  const size = 25;
  const status = libraryStatus();
  root.innerHTML = `<div class="page-heading"><div><h1>词语库管理</h1><p id="library-count-summary">发布词库 ${status.bundled} 条 · 当前本机 ${vocabulary.length} 条</p></div>${backButton()}</div><p class="notice">这里的修改只保存在本机，不会改变其他学生的词库。发布给全班：导出 JSON，再使用项目导入命令更新并部署。</p>${localLibraryNotice ? `<p class="notice">${e(localLibraryNotice)}</p>` : ''}<div class="panel"><div class="library-actions"><button class="btn primary" id="add-vocabulary">＋ 添加词语</button><label class="btn" for="vocabulary-file">导入 Excel / CSV / JSON</label><input type="file" id="vocabulary-file" accept=".xlsx,.xls,.csv,.json"><button class="btn" data-export="json">导出 JSON</button><button class="btn" data-export="csv">导出 CSV</button><button class="btn" data-export="xlsx">导出 XLSX</button><a class="btn" href="./templates/vocabulary-template.csv" download>下载 CSV 模板</a><button class="btn" id="restore-vocabulary">恢复发布词库</button></div><p id="library-status" role="status" aria-live="polite"></p><div id="import-preview"></div><div class="library-controls"><label>搜索词语、拼音或意思<input id="manage-search" type="search"></label>${[
    ['grade', '年级', ['1', '2', '3', '4', '5', '6']],
    ['category', '类别', vocabularyService.values('category')],
    ['difficulty', '词语难度', ['1', '2', '3']],
    ['tag', '标签', vocabularyService.values('tags')],
    ['essayTopic', '作文主题', vocabularyService.values('essayTopics')],
  ]
    .map(
      ([k, label, values]) =>
        `<label>${label}<select data-library-filter="${k}"><option value="all">全部</option>${values.map((v) => `<option value="${e(v)}">${e(k === 'grade' ? prettyGrade(v) : v)}</option>`).join('')}</select></label>`,
    )
    .join('')}<label>排序<select id="manage-sort">${[
    ['word', '词语'],
    ['grade', '年级'],
    ['pinyin', '拼音'],
    ['category', '类别'],
    ['difficulty', '难度'],
    ['id', '编号'],
  ]
    .map(([v, l]) => `<option value="${v}">${l}</option>`)
    .join(
      '',
    )}</select></label><button class="btn" id="manage-direction" aria-label="切换排序方向">↑ 升序</button></div><p id="manage-count" role="status"></p><div class="vocabulary-table-wrap"><table class="vocabulary-table"><thead><tr><th>词语 / 拼音</th><th>年级 / 词性 / 类别</th><th>例句</th><th>难度 / 标签</th><th>操作</th></tr></thead><tbody id="manage-rows"></tbody></table></div><div id="manage-pages" class="pagination"></div></div>`;
  const message = (text, error = false) => {
    if (disposed) return;
    const el = $('#library-status', root);
    el.textContent = text;
    el.className = error ? 'notice' : '';
  };
  function draw() {
    clearTimeout(searchTimer);
    $('#library-count-summary', root).textContent =
      `发布词库 ${libraryStatus().bundled} 条 · 当前本机 ${vocabulary.length} 条`;
    for (const [key, field] of [
      ['category', 'category'],
      ['tag', 'tags'],
      ['essayTopic', 'essayTopics'],
    ]) {
      const el = root.querySelector(`[data-library-filter="${key}"]`),
        current = filters[key] || 'all';
      const values = [
        ...new Set([...vocabularyService.values(field), ...(current === 'all' ? [] : [current])]),
      ];
      el.innerHTML =
        '<option value="all">全部</option>' +
        values.map((v) => `<option value="${e(v)}">${e(v)}</option>`).join('');
      el.value = current;
    }
    const records = vocabularyService
      .searchWords(query, filters)
      .sort(
        (a, b) =>
          direction *
          (sort === 'grade' || sort === 'difficulty'
            ? (a[sort] || 0) - (b[sort] || 0)
            : String(a[sort] || '').localeCompare(String(b[sort] || ''), 'zh-Hans')),
      );
    const pages = Math.max(1, Math.ceil(records.length / size));
    page = Math.min(page, pages - 1);
    $('#manage-count', root).textContent = `${records.length} 条 · 第 ${page + 1} / ${pages} 页`;
    $('#manage-rows', root).innerHTML =
      records
        .slice(page * size, (page + 1) * size)
        .map(
          (w) =>
            `<tr><td><button class="word-title" data-word-card="${e(w.id)}">${e(w.word)}</button><small>${e(w.pinyin)}</small><small>${e(w.meaningEnglish)} ${e(w.meaningMalay)}</small></td><td>${prettyGrade(w.grade)}<small>${e(w.partOfSpeech)} ${e(w.category)}</small></td><td>${e(w.exampleSentence) || '—'}</td><td>${e(w.difficulty ?? '—')}<small>${w.tags.map(e).join('、')}</small></td><td><div class="row"><button class="btn" data-edit-vocabulary="${e(w.id)}" aria-label="编辑${e(w.word)}">编辑</button><button class="btn" data-delete-vocabulary="${e(w.id)}" aria-label="删除${e(w.word)}">删除</button></div></td></tr>`,
        )
        .join('') || '<tr><td colspan="5">没有符合条件的词语。</td></tr>';
    $('#manage-pages', root).innerHTML =
      `<button class="btn" id="manage-prev" ${page === 0 ? 'disabled' : ''}>上一页</button><span>${page + 1} / ${pages}</span><button class="btn" id="manage-next" ${page + 1 >= pages ? 'disabled' : ''}>下一页</button>`;
    $('#manage-prev', root).onclick = () => {
      page--;
      draw();
    };
    $('#manage-next', root).onclick = () => {
      page++;
      draw();
    };
  }
  async function commit(records) {
    await changeLocalVocabulary(records);
    draw();
    message(`已保存 ${vocabulary.length} 条词语到本机。请导出备份；学生学习记录保留。`);
  }
  function editor(item) {
    if (item) item = exportRecords([item])[0];
    const modal = showModal(
      item ? '编辑词语' : '添加词语',
      `<form id="vocabulary-editor"><p class="small muted">词语和年级必填；编号留空会自动生成。多项资料可使用分号；导出的 JSON 数组也可直接填写。</p><div class="vocabulary-form">${fields.map((f) => `<label>${labels[f]}${['exampleSentence', ...listFields].includes(f) ? `<textarea name="${f}" ${f === 'exampleSentence' ? 'rows="3"' : ''}>${e(listFields.includes(f) ? JSON.stringify(item?.[f] || []) : item?.[f] || '')}</textarea>` : `<input name="${f}" value="${e(item?.[f] ?? '')}" ${item && ['id', 'word', 'grade'].includes(f) ? 'readonly' : ''} ${['word', 'grade'].includes(f) ? 'required' : ''} ${f === 'grade' ? 'inputmode="numeric"' : ''}>`}</label>`).join('')}</div>${item ? '<p class="small muted">编号、词语与年级保持不变以保留学习记录。若是另一个词或年级，请添加新记录。</p>' : ''}<p id="editor-error" role="alert"></p><div class="action-bar"><button class="btn primary" type="submit">保存词语</button><button class="btn" type="button" id="cancel-editor">取消</button></div></form>`,
    );
    $('#cancel-editor', modal).onclick = closeModal;
    $('#vocabulary-editor', modal).onsubmit = async (event) => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      try {
        const raw = Object.fromEntries(new FormData(event.target));
        const p = previewRows([raw], exportRecords(vocabulary));
        const entry = p.entries[0];
        if (!['new', 'existing'].includes(entry.status)) throw Error(entry.reason);
        if (!item && entry.status === 'existing') throw Error('词语已存在，请使用编辑按钮。');
        await commit(applyImport(exportRecords(vocabulary), p, { duplicates: 'update' }));
        closeModal();
      } catch (error) {
        $('#editor-error', modal).textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
  }
  function runWorker(data) {
    return new Promise((resolve, reject) => {
      if (worker) {
        reject(Error('文件仍在处理中，请稍候。'));
        return;
      }
      worker = new Worker(new URL('../js/vocabulary-worker.js', import.meta.url), {
        type: 'module',
      });
      const current = worker,
        timer = setTimeout(() => {
          current.terminate();
          worker = null;
          reject(Error('处理超时，请分批导入。'));
        }, 60000);
      current.onmessage = ({ data }) => {
        clearTimeout(timer);
        current.terminate();
        worker = null;
        data.error ? reject(Error(data.error)) : resolve(data.result);
      };
      current.onerror = () => {
        clearTimeout(timer);
        current.terminate();
        worker = null;
        reject(Error('无法处理文件，请检查文件格式或重新载入页面。'));
      };
      current.postMessage(data);
    });
  }
  function drawPreview() {
    const box = $('#import-preview', root);
    if (!preview) {
      box.innerHTML = '';
      return;
    }
    const c = preview.counts;
    box.innerHTML = `<section class="notice"><h2>导入预览 · ${e(preview.name)}</h2><p>检测行数 ${c.rows} · 有效新词 ${c.new} · 已有词语 ${c.existing} · 重复行 ${c.duplicate} · 不完整 ${c.incomplete} · 无效 ${c.invalid}</p><p class="small">跨年级同词 ${c.crossGrade}（允许）。重复、无效及不完整行不会写入。请先备份。</p><div class="library-controls"><label>导入方式<select id="import-mode"><option value="merge">合并现有词库（安全默认）</option><option value="replace">替换完整词库</option></select></label><label>已有词语<select id="import-duplicates"><option value="skip">跳过已有词语</option><option value="update">更新已有词语</option></select></label></div><label class="check-row"><input type="checkbox" id="import-problems" ${problems ? 'checked' : ''}>只看问题或提示</label><div id="import-entries"></div><div id="import-pages" class="pagination"></div><div class="action-bar"><button class="btn primary" id="confirm-import" ${c.new + c.existing === 0 ? 'disabled' : ''}>确认导入有效记录</button><button class="btn" id="cancel-import">取消导入</button><button class="btn" id="export-import-report">导出检查报告 JSON</button></div></section>`;
    function rows() {
      const entries = preview.entries.filter(
        (x) => !problems || !['new', 'existing'].includes(x.status) || x.warning,
      );
      const pages = Math.max(1, Math.ceil(entries.length / size));
      importPage = Math.min(importPage, pages - 1);
      $('#import-entries', root).innerHTML =
        entries
          .slice(importPage * size, (importPage + 1) * size)
          .map(
            (x) =>
              `<details class="import-row"><summary>${e(x.sheet)} · Row ${x.row} — ${e(x.record?.word || '')} · ${e(x.reason || x.status)} ${e(x.warning || '')}</summary><pre>${e(JSON.stringify(x.record || x.raw, null, 2))}</pre></details>`,
          )
          .join('') || '<p>没有问题记录。</p>';
      $('#import-pages', root).innerHTML =
        `<button class="btn" id="import-prev" ${importPage === 0 ? 'disabled' : ''}>上一页</button><span>${importPage + 1} / ${pages}</span><button class="btn" id="import-next" ${importPage + 1 >= pages ? 'disabled' : ''}>下一页</button>`;
      $('#import-prev', root).onclick = () => {
        importPage--;
        rows();
      };
      $('#import-next', root).onclick = () => {
        importPage++;
        rows();
      };
    }
    rows();
    $('#import-problems', root).onchange = (ev) => {
      problems = ev.target.checked;
      importPage = 0;
      rows();
    };
    $('#cancel-import', root).onclick = () => {
      preview = null;
      drawPreview();
      message('已取消导入。');
    };
    $('#export-import-report', root).onclick = () =>
      download(
        'vocabulary-import-report.json',
        JSON.stringify(preview, null, 2),
        'application/json',
      );
    $('#import-mode', root).onchange = (ev) => {
      $('#import-duplicates', root).disabled = ev.target.value === 'replace';
    };
    $('#confirm-import', root).onclick = () => {
      if (preview.base !== JSON.stringify(exportRecords(vocabulary))) {
        message('词库在预览后已改变，请重新选择文件以更新预览。', true);
        return;
      }
      const options = {
        mode: $('#import-mode', root).value,
        duplicates: $('#import-duplicates', root).value,
      };
      const perform = async () => {
        const button = $('#confirm-import', root);
        button.disabled = true;
        try {
          const result = applyImport(exportRecords(vocabulary), preview, options);
          if (!result.length) throw Error('Cannot import an empty library / 不能导入空词库');
          await commit(result);
          preview = null;
          drawPreview();
        } catch (error) {
          message(error.message, true);
          button.disabled = false;
        }
      };
      if (options.mode === 'replace')
        confirmAction(
          '替换完整本机词库？',
          `现有 ${vocabulary.length} 条将由预览中的 ${c.new + c.existing} 条有效记录替换。无效行将被排除。请先导出备份。`,
          perform,
          '确认替换词库',
        );
      else perform();
    };
  }
  $('#add-vocabulary', root).onclick = () => editor();
  let searchTimer;
  $('#manage-search', root).oninput = (ev) => {
    query = ev.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      page = 0;
      draw();
    }, 120);
  };
  $('#manage-sort', root).onchange = (ev) => {
    sort = ev.target.value;
    page = 0;
    draw();
  };
  $('#manage-direction', root).onclick = (ev) => {
    direction *= -1;
    ev.target.textContent = direction === 1 ? '↑ 升序' : '↓ 降序';
    draw();
  };
  root.querySelectorAll('[data-library-filter]').forEach(
    (el) =>
      (el.onchange = () => {
        filters[el.dataset.libraryFilter] = el.value;
        page = 0;
        draw();
      }),
  );
  const controller = new AbortController();
  root.addEventListener(
    'click',
    async (ev) => {
      const edit = ev.target.closest('[data-edit-vocabulary]'),
        del = ev.target.closest('[data-delete-vocabulary]'),
        exp = ev.target.closest('[data-export]');
      if (edit) editor(vocabularyService.getWordById(edit.dataset.editVocabulary));
      if (del) {
        const word = vocabularyService.getWordById(del.dataset.deleteVocabulary);
        confirmAction(
          '删除本机词语？',
          `删除“${word.word}”？历史学习记录仍会保留。`,
          () =>
            commit(exportRecords(vocabulary.filter((w) => w.id !== word.id))).catch((err) =>
              message(err.message, true),
            ),
          '确认删除',
        );
      }
      if (exp) {
        exp.disabled = true;
        message('正在准备导出……');
        try {
          const format = exp.dataset.export,
            records = exportRecords(vocabulary);
          const content =
            format === 'json'
              ? JSON.stringify(records, null, 2)
              : await runWorker({ action: 'export', format, records });
          download(
            'vocabulary.' + format,
            content,
            format === 'json'
              ? 'application/json'
              : format === 'xlsx'
                ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                : 'text/csv;charset=utf-8',
          );
          message('词库已导出，包含全部编号和资料。');
        } catch (error) {
          message(error.message, true);
        } finally {
          exp.disabled = false;
        }
      }
    },
    { signal: controller.signal },
  );
  $('#vocabulary-file', root).onchange = async (ev) => {
    const input = ev.target,
      file = input.files[0];
    if (!file) return;
    preview = null;
    drawPreview();
    input.disabled = true;
    message('正在处理文件与检查重复记录……');
    try {
      if (file.size > 25 * 1024 * 1024) throw Error('文件超过 25 MB，请分批导入。');
      const result = await runWorker({
        name: file.name,
        buffer: await file.arrayBuffer(),
        existing: exportRecords(vocabulary),
      });
      if (disposed) return;
      preview = { ...result, name: file.name, base: JSON.stringify(exportRecords(vocabulary)) };
      importPage = 0;
      drawPreview();
      message(
        result.counts.rows ? '请检查预览，再确认导入。' : '文件没有词语记录。',
        !result.counts.rows,
      );
    } catch (error) {
      message(error.message, true);
    } finally {
      input.disabled = false;
      input.value = '';
    }
  };
  $('#restore-vocabulary', root).onclick = () =>
    confirmAction(
      '恢复发布词库？',
      '清除本机词库修改。请先导出备份。学习记录不受影响。',
      async () => {
        try {
          await resetLocalVocabulary();
          draw();
          message('已恢复发布词库。');
        } catch (error) {
          message(error.message, true);
        }
      },
      '确认恢复',
    );
  draw();
  return () => {
    disposed = true;
    worker?.terminate();
    clearTimeout(searchTimer);
    controller.abort();
  };
}
