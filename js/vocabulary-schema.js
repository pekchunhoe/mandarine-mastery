export const listFields = ['synonyms', 'antonyms', 'collocations', 'essayTopics', 'tags'];
export const fields = [
  'id',
  'word',
  'pinyin',
  'meaningEnglish',
  'meaningMalay',
  'grade',
  'partOfSpeech',
  'category',
  'difficulty',
  'exampleSentence',
  'sentencePinyin',
  ...listFields,
  'source',
  'character',
  'lesson',
  'generatedSynonyms',
  'definitionChinese',
];
const aliases = {
  词语: 'word',
  詞語: 'word',
  拼音: 'pinyin',
  年级: 'grade',
  年級: 'grade',
  例句: 'exampleSentence',
  参考造句: 'exampleSentence',
  example: 'exampleSentence',
  词性: 'partOfSpeech',
  类别: 'category',
  难度: 'difficulty',
  标签: 'tags',
  作文主题: 'essayTopics',
  英文意思: 'meaningEnglish',
  马来文意思: 'meaningMalay',
  例句拼音: 'sentencePinyin',
  近义词: 'synonyms',
  反义词: 'antonyms',
  搭配: 'collocations',
  来源: 'source',
  生字: 'character',
  课次: 'lesson',
  编号: 'id',
  english: 'meaningEnglish',
  malay: 'meaningMalay',
  year: 'grade',
};
const key = (s) =>
  String(s)
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/[\s_-]/g, '')
    .toLowerCase();
const headings = new Map([
  ...fields.map((f) => [key(f), f]),
  ...Object.entries(aliases).map(([a, b]) => [key(a), b]),
]);
export const columnName = (s) => headings.get(key(s));
export function gradeNumber(value) {
  const text = String(value ?? '').trim();
  if (/^[1-6]$/.test(text)) return Number(text);
  const match = text.match(/^(?:year\s*|tahun\s*|第)?([1-6一二三四五六])(?:\s*年级|\s*年級)?$/i);
  return match ? Number(match[1]) || '一二三四五六'.indexOf(match[1]) + 1 : null;
}
export function listValue(value) {
  if (value == null || value === '') return [];
  if (typeof value === 'string' && value.trim().startsWith('[')) value = JSON.parse(value);
  const values = Array.isArray(value) ? value : String(value).split(/[;；|、\n]/);
  if (values.some((v) => typeof v !== 'string'))
    throw Error('列表必须包含文字 / Lists must contain text');
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}
export const identity = (w) => JSON.stringify([w.word, w.grade]);
export const generatedId = (w) =>
  `Y${w.grade}-${[...w.word].map((c) => c.codePointAt(0).toString(16)).join('-')}${w.character ? '-c' + [...w.character].map((c) => c.codePointAt(0).toString(16)).join('-') : ''}`;
export function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw Error('Invalid record / 无效记录');
  const supplied = {};
  for (const [k, v] of Object.entries(raw)) {
    const f = columnName(k);
    if (f) supplied[f] = v;
  }
  const record = {};
  for (const f of fields) {
    const v = supplied[f];
    if (listFields.includes(f)) record[f] = listValue(v);
    else if (f === 'grade') record[f] = gradeNumber(v);
    else if (f === 'difficulty') {
      record[f] =
        v == null || v === ''
          ? null
          : { easy: 1, medium: 2, hard: 3, 简单: 1, 中等: 2, 困难: 3 }[String(v).toLowerCase()] ||
            Number(v);
      if (record[f] !== null && ![1, 2, 3].includes(record[f]))
        throw Error('Invalid difficulty (1–3) / 难度须为 1–3');
    } else if (f === 'lesson') record[f] = v == null || v === '' ? null : String(v).trim();
    else {
      if (v != null && !['string', 'number'].includes(typeof v))
        throw Error(`Invalid text / 文字格式错误: ${f}`);
      record[f] = v == null ? '' : f === 'exampleSentence' ? String(v) : String(v).trim();
    }
  }
  if (!record.word) throw Error('Missing word / 缺少词语');
  if (!record.grade)
    throw Error(
      supplied.grade == null || supplied.grade === ''
        ? 'Missing grade / 缺少年级'
        : 'Invalid grade (Year 1–6) / 年级须为 1–6',
    );
  if (record.character && !record.word.includes(record.character))
    throw Error('Source character is not in word / 生字不在词语中');
  if (record.id && /[\u0000-\u001F\u007F]/.test(record.id))
    throw Error('Malformed ID: control characters are not allowed / 编号格式错误');
  if (record.id.length > 512 || record.word.length > 200)
    throw Error('ID or word is too long / 编号或词语过长');
  record.id ||= generatedId(record);
  if (Object.hasOwn(Object.prototype, record.id) || record.id === 'prototype')
    throw Error('Reserved ID; choose another identifier / 此编号保留，请更换');
  return {
    record,
    supplied: Object.keys(supplied),
    explicitId: !!String(supplied.id ?? '').trim(),
  };
}
export function previewRows(rows, existing = []) {
  const byId = new Map(existing.map((w) => [w.id, w])),
    byKey = new Map(),
    byWord = new Map();
  for (const w of existing) {
    const k = identity(w);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(w);
    byWord.set(w.word, true);
  }
  const seenIds = new Set(),
    seenKeys = new Map();
  const entries = [],
    counts = {
      rows: 0,
      new: 0,
      existing: 0,
      duplicate: 0,
      incomplete: 0,
      invalid: 0,
      crossGrade: 0,
    };
  for (const [i, input] of rows.entries()) {
    const raw = input && Object.hasOwn(input, 'raw') ? input.raw : input;
    if (
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      Object.values(raw).every((v) => v == null || String(v).trim() === '')
    )
      continue;
    counts.rows++;
    const entry = {
      row: input?.row ?? i + 2,
      sheet: input?.sheet || '',
      status: 'invalid',
      reason: '',
      raw,
    };
    try {
      const n = normalizeRecord(raw);
      Object.assign(entry, n);
      const w = n.record,
        k = identity(w),
        sameId = byId.get(w.id),
        sameWords = byKey.get(k) || [];
      const candidates = w.character
        ? sameWords.filter((x) => x.character === w.character)
        : sameWords;
      if (sameId && identity(sameId) !== k)
        throw Error('ID belongs to a different word or grade / 编号已用于另一词语或年级');
      else if (seenIds.has(w.id)) {
        entry.status = 'duplicate';
        entry.reason = 'Duplicate ID / 重复编号';
      } else if (
        (seenKeys.get(k) || []).some(
          (x) => !w.character || !x.character || x.character === w.character,
        )
      ) {
        entry.status = 'duplicate';
        entry.reason = 'Duplicate vocabulary row / 重复词语行';
      } else {
        const match = sameId || (candidates.length === 1 ? candidates[0] : null);
        if (!sameId && candidates.length > 1)
          throw Error('Multiple existing source records: specify ID / 多条来源，请填写原编号');
        if (match && n.explicitId && match.id !== w.id)
          throw Error('Existing word has another ID: retain its ID / 已有词语，请保留原编号');
        if (match) {
          w.id = match.id;
          entry.existingId = match.id;
          entry.status = 'existing';
          entry.reason = 'Existing word / 已有词语';
        } else {
          entry.status = 'new';
          if (byWord.has(w.word) && !sameWords.length) {
            counts.crossGrade++;
            entry.reason = 'Same word in another year (allowed) / 跨年级词语，保留';
          }
        }
      }
      seenIds.add(w.id);
      if (!seenKeys.has(k)) seenKeys.set(k, []);
      seenKeys.get(k).push(w);
      if (!w.exampleSentence)
        entry.warning =
          'No example: sentence-dependent tasks use independent writing / 未填例句，相关活动使用自主造句';
      else if (!w.exampleSentence.includes(w.word))
        entry.warning = 'Example does not contain target; kept unchanged / 例句未含词语，原文保留';
    } catch (error) {
      entry.reason = error.message;
      entry.status = /^Missing/.test(error.message) ? 'incomplete' : 'invalid';
    }
    counts[entry.status]++;
    entries.push(entry);
  }
  return { counts, entries };
}
export function applyImport(existing, preview, { mode = 'merge', duplicates = 'skip' } = {}) {
  if (!['merge', 'replace'].includes(mode) || !['skip', 'update'].includes(duplicates))
    throw Error('Invalid import option');
  const result = new Map((mode === 'replace' ? [] : existing).map((w) => [w.id, w]));
  for (const entry of preview.entries) {
    if (!['new', 'existing'].includes(entry.status)) continue;
    if (entry.status === 'existing' && mode === 'merge' && duplicates === 'skip') continue;
    const old = result.get(entry.record.id);
    const record = old
      ? {
          ...old,
          ...Object.fromEntries(
            entry.supplied.filter((f) => f !== 'id').map((f) => [f, entry.record[f]]),
          ),
        }
      : entry.record;
    result.set(entry.record.id, { ...record, id: entry.record.id });
  }
  return [...result.values()];
}
