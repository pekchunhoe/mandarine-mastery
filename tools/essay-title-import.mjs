import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from '../vendor/xlsx.mjs';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const masterWorkbook = path.join(root, 'data/master-essay-titles.xlsx');
export const runtimeDataset = path.join(root, 'data/essay-titles.json');
export const runtimeContentDataset = path.join(root, 'data/essay-contents.json');
export const importReport = path.join(root, 'test-results/essay-title-import-report.json');
export const contentImportState = path.join(root, 'test-results/essay-content-import-state.json');
export const MAX_REMOVED_RECORDS = 25;
export const MAX_REMOVAL_RATE = 0.1;
export const columns = Object.freeze([
  'id', 'title', 'title_pinyin', 'grade', 'category', 'theme', 'essay_type', 'difficulty',
  'description', 'suggested_keywords', 'suggested_phrases', 'writing_guidance', 'activity_tags',
  'min_words', 'max_words', 'active', 'sort_order', 'notes',
]);
export const contentColumns = Object.freeze([
  'content_id', 'essay_id', 'content_title', 'content', 'word_count', 'level', 'version', 'active', 'sort_order', 'notes',
]);
const text = (value) => String(value ?? '').trim();
const split = (value, separator = /[；;]/) => text(value).split(separator).map((item) => item.trim()).filter(Boolean);
const numeric = (value, name, row, { integer = false, sheet = 'EssayTitles' } = {}) => {
  if (text(value) === '') return null;
  const result = Number(value);
  if (!Number.isFinite(result) || (integer && !Number.isInteger(result))) throw Error(`${sheet} Row ${row}: ${name} must be ${integer ? 'an integer' : 'numeric'}.`);
  return result;
};
const gradeRange = (value, row) => {
  const match = text(value).match(/^(\d)(?:\s*[-–]\s*(\d))?$/);
  if (!match) throw Error(`EssayTitles Row ${row}: grade must be 1–6 or a range such as 3-4.`);
  const min = Number(match[1]), max = Number(match[2] || match[1]);
  if (min < 1 || max > 6 || min > max) throw Error(`EssayTitles Row ${row}: grade must be within 1–6.`);
  return { grade: match[2] ? `${min}-${max}` : min, gradeMin: min, gradeMax: max };
};
const activeValue = (value, row, sheet = 'EssayTitles') => {
  if (typeof value === 'boolean') return value;
  const normalized = text(value).toLowerCase();
  if (['true', 'yes', '1', '是', '启用'].includes(normalized)) return true;
  if (['false', 'no', '0', '否', '停用'].includes(normalized)) return false;
  throw Error(`${sheet} Row ${row}: active must be true or false.`);
};
const defaultEssayType = (category) => category === '看图作文' ? '看图作文' : category === '想象' ? '想象作文' : '命题作文';

// Counts Chinese characters plus letters/numbers, excluding whitespace and punctuation.
export const countCompositionCharacters = (value) => [...String(value ?? '').matchAll(/[\p{L}\p{N}]/gu)].length;

export function normalizeRows(rows) {
  const ids = new Set(), logicalRecords = new Set(), records = [], duplicates = [];
  for (const { raw, row } of rows) {
    const id = text(raw.id), title = text(raw.title);
    if (!id) throw Error(`EssayTitles Row ${row}: id cannot be blank.`);
    if (!title) throw Error(`EssayTitles Row ${row}: title cannot be blank.`);
    if (title.includes('\uFFFD')) throw Error(`EssayTitles Row ${row}: title contains invalid Unicode.`);
    if (ids.has(id)) throw Error(`EssayTitles Row ${row}: duplicate id “${id}”.`);
    ids.add(id);
    const range = gradeRange(raw.grade, row), category = text(raw.category);
    if (!category) throw Error(`EssayTitles Row ${row}: category cannot be blank.`);
    const minWords = numeric(raw.min_words, 'min_words', row, { integer: true });
    const maxWords = numeric(raw.max_words, 'max_words', row, { integer: true });
    if ((minWords != null && minWords < 0) || (maxWords != null && maxWords < 0)) throw Error(`EssayTitles Row ${row}: word limits cannot be negative.`);
    if (minWords != null && maxWords != null && minWords > maxWords) throw Error(`EssayTitles Row ${row}: min_words cannot exceed max_words.`);
    const keywords = split(raw.suggested_keywords), guidance = split(raw.writing_guidance);
    const record = {
      id, title, titlePinyin: text(raw.title_pinyin), ...range, category, theme: text(raw.theme) || category,
      essayType: text(raw.essay_type) || defaultEssayType(category),
      difficulty: numeric(raw.difficulty, 'difficulty', row, { integer: true }) ?? range.gradeMin,
      description: text(raw.description), suggestedKeywords: keywords, suggestedPhrases: split(raw.suggested_phrases),
      writingGuidance: guidance, activityTags: split(raw.activity_tags, /[,，；;]/), minWords, maxWords,
      active: activeValue(raw.active, row), sortOrder: numeric(raw.sort_order, 'sort_order', row, { integer: true }) ?? Number.MAX_SAFE_INTEGER,
      notes: text(raw.notes), keywords: keywords.length ? keywords : [category], writingFunctions: guidance,
    };
    const logicalKey = [title, record.gradeMin, record.gradeMax, category, record.essayType].join('\u0000');
    if (logicalRecords.has(logicalKey)) duplicates.push({ row, id, title });
    logicalRecords.add(logicalKey);
    records.push(record);
  }
  if (!records.length) throw Error('EssayTitles contains no records. No data was changed.');
  return { records, duplicates };
}

export function normalizeContentRows(rows, titleIds) {
  const ids = new Set(), records = [], warnings = [];
  for (const { raw, row } of rows) {
    const contentId = text(raw.content_id), essayId = text(raw.essay_id);
    const content = String(raw.content ?? '').replace(/\r\n?/g, '\n').trim();
    if (!contentId) throw Error(`EssayContents Row ${row}: content_id cannot be blank.`);
    if (contentId.includes('\uFFFD')) throw Error(`EssayContents Row ${row}: content_id contains invalid Unicode.`);
    if (ids.has(contentId)) throw Error(`EssayContents Row ${row}: duplicate content_id “${contentId}”.`);
    ids.add(contentId);
    if (!essayId) throw Error(`EssayContents Row ${row}: essay_id cannot be blank.`);
    if (essayId.includes('\uFFFD')) throw Error(`EssayContents Row ${row}: essay_id contains invalid Unicode.`);
    if (!titleIds.has(essayId)) throw Error(`EssayContents Row ${row}: essay_id “${essayId}” does not exist in EssayTitles.`);
    if (!content) throw Error(`EssayContents Row ${row}: content cannot be blank.`);
    if (content.includes('\uFFFD')) throw Error(`EssayContents Row ${row}: content contains invalid Unicode.`);
    const level = text(raw.level), version = text(raw.version);
    if (!level) throw Error(`EssayContents Row ${row}: level cannot be blank.`);
    if (!version) throw Error(`EssayContents Row ${row}: version cannot be blank.`);
    const suppliedCount = numeric(raw.word_count, 'word_count', row, { integer: true, sheet: 'EssayContents' });
    if (suppliedCount != null && suppliedCount < 0) throw Error(`EssayContents Row ${row}: word_count cannot be negative.`);
    const wordCount = countCompositionCharacters(content);
    if (suppliedCount != null && suppliedCount !== wordCount)
      warnings.push({ row, contentId, type: 'word_count_normalized', supplied: suppliedCount, calculated: wordCount });
    if (wordCount < 150 || wordCount > 600)
      throw Error(`EssayContents Row ${row}: content length ${wordCount} is outside the allowed 150–600 range.`);
    if (wordCount < 200 || wordCount > 400)
      warnings.push({ row, contentId, type: 'length_outside_recommended_range', calculated: wordCount, recommended: '200–400', allowed: '150–600' });
    const sortOrder = numeric(raw.sort_order, 'sort_order', row, { integer: true, sheet: 'EssayContents' });
    if (sortOrder != null && sortOrder < 0) throw Error(`EssayContents Row ${row}: sort_order cannot be negative.`);
    records.push({
      contentId, essayId, contentTitle: text(raw.content_title), content, wordCount, level, version,
      active: activeValue(raw.active, row, 'EssayContents'), sortOrder: sortOrder ?? Number.MAX_SAFE_INTEGER, notes: text(raw.notes),
    });
  }
  return { records, warnings };
}

const rowsForWorksheet = (workbook, sheetName, requiredColumns) => {
  if (!workbook.SheetNames.includes(sheetName)) throw Error(`Missing required worksheet: ${sheetName}.`);
  const sheet = workbook.Sheets[sheetName];
  if (sheet['!ref'] && XLSX.utils.decode_range(sheet['!ref']).e.r >= 50000) throw Error(`${sheetName} exceeds the 50,000-row limit.`);
  for (const [address, cell] of Object.entries(sheet)) if (!address.startsWith('!') && cell.f) throw Error(`${sheetName} ${address}: formulas are not allowed.`);
  const table = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: true });
  const headerRow = table.findIndex((row) => row.some((value) => text(value)));
  if (headerRow < 0) throw Error(`${sheetName} is empty.`);
  const headers = table[headerRow].map(text);
  if (headers.some((header) => !header)) throw Error(`${sheetName} has a blank column name; remove extra cells or name the column.`);
  if (new Set(headers).size !== headers.length) throw Error(`${sheetName} has duplicate column names.`);
  const missing = requiredColumns.filter((column) => !headers.includes(column));
  if (missing.length) throw Error(`${sheetName} is missing required columns: ${missing.join(', ')}.`);
  return table.slice(headerRow + 1).flatMap((row, index) => {
    if (!row.some((value) => text(value))) return [];
    if (row.length > headers.length && row.slice(headers.length).some((value) => text(value))) throw Error(`${sheetName} Row ${headerRow + index + 2}: extra cells are not allowed.`);
    return [{ row: headerRow + index + 2, raw: Object.fromEntries(headers.map((header, col) => [header, row[col] ?? ''])) }];
  });
};

export async function readEssayWorkbookData(file) {
  if ((await stat(file)).size > 25 * 1024 * 1024) throw Error('Essay workbook exceeds 25 MB.');
  const buffer = await readFile(file);
  if (buffer[0] !== 80 || buffer[1] !== 75) throw Error('Essay workbook is not a valid .xlsx file.');
  const workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: true, sheetRows: 50002 });
  return {
    titleRows: rowsForWorksheet(workbook, 'EssayTitles', columns),
    contentRows: rowsForWorksheet(workbook, 'EssayContents', contentColumns),
  };
}
// Kept for callers that only need title rows.
export async function readEssayWorkbook(file) { return (await readEssayWorkbookData(file)).titleRows; }
export async function readEssayContentWorkbook(file) { return (await readEssayWorkbookData(file)).contentRows; }

export function analyzeEssayChange(existing, next, key = 'id') {
  const oldById = new Map(existing.map((record) => [record[key], record])), newById = new Map(next.map((record) => [record[key], record]));
  const added = next.filter((record) => !oldById.has(record[key])), removed = existing.filter((record) => !newById.has(record[key]));
  const updated = next.filter((record) => oldById.has(record[key]) && JSON.stringify(record) !== JSON.stringify(oldById.get(record[key])));
  const removalRate = existing.length ? removed.length / existing.length : 0;
  return { current: existing.length, imported: next.length, added, updated, unchanged: next.length - added.length - updated.length, removed, removalRate, blocked: removed.length > MAX_REMOVED_RECORDS || removalRate > MAX_REMOVAL_RATE };
}
export const analyzeEssayContentChange = (existing, next) => analyzeEssayChange(existing, next, 'contentId');
export function enforceRemovalGuard(change, { allowRemovals = false } = {}) {
  if (!change.blocked || allowRemovals) return;
  throw Error(`Essay update aborted: ${change.removed.length} records (${(change.removalRate * 100).toFixed(1)}%) would be removed. No runtime data was changed. Review removed IDs/titles and rerun with --allow-removals only for an intentional deletion.`);
}
async function importEssayTitlesLegacy({ file = masterWorkbook, target = runtimeDataset, report = importReport, backupDirectory = path.join(root, 'docs/essay-title-backups'), allowRemovals = false } = {}) {
  const existing = JSON.parse(await readFile(target, 'utf8'));
  const { records, duplicates } = normalizeRows(await readEssayWorkbook(file));
  const change = analyzeEssayChange(existing, records);
  const compact = (list) => list.map(({ id, title }) => ({ id, title }));
  await mkdir(path.dirname(report), { recursive: true });
  await writeFile(report, JSON.stringify({ file: path.relative(root, file), records: records.length, duplicateRecords: duplicates, change: { ...change, added: compact(change.added), updated: compact(change.updated), removed: compact(change.removed) } }, null, 2) + '\n', 'utf8');
  console.log(`Current: ${change.current}\nExcel: ${change.imported}\nNew: ${change.added.length}\nUpdated: ${change.updated.length}\nRemoved: ${change.removed.length}\nDuplicate logical records reported: ${duplicates.length}`);
  if (change.removed.length) console.warn(`Removed records:\n${change.removed.map(({ id, title }) => `${id}  ${title}`).join('\n')}`);
  enforceRemovalGuard(change, { allowRemovals });
  await mkdir(backupDirectory, { recursive: true });
  const backup = path.join(backupDirectory, `essay-titles-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await copyFile(target, backup);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(records, null, 2) + '\n', 'utf8');
  await rename(temporary, target);
  console.log(`Updated ${change.current} → ${records.length}. Backup: ${path.relative(root, backup)}`);
  return { records, duplicates, change, backup };
}
const readDataset = async (file, fallback = []) => {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
};
const readContentImportState = async (file) => {
  const state = await readDataset(file, null);
  return new Set(Array.isArray(state?.generatedContentIds) ? state.generatedContentIds : []);
};
const compactTitles = (list) => list.map(({ id, title }) => ({ id, title }));
const compactContents = (list, titles) => list.map(({ contentId, essayId }) => ({ contentId, essayId, title: titles.get(essayId)?.title || '' }));
const compactChange = (change, compact) => ({ ...change, added: compact(change.added), updated: compact(change.updated), removed: compact(change.removed) });
const printChange = (label, change) => console.log(`${label} current: ${change.current}\n${label} Excel: ${change.imported}\n${label} new: ${change.added.length}\n${label} updated: ${change.updated.length}\n${label} removed: ${change.removed.length}`);

export async function importEssayTitles({
  file = masterWorkbook, target = runtimeDataset, contentTarget: requestedContentTarget, report = importReport,
  state: requestedState, backupDirectory = path.join(root, 'docs/essay-title-backups'), allowRemovals = false,
} = {}) {
  const contentTarget = requestedContentTarget ?? (target === runtimeDataset ? runtimeContentDataset : path.join(path.dirname(target), 'essay-contents.json'));
  const state = requestedState ?? (target === runtimeDataset ? contentImportState : path.join(path.dirname(target), '.essay-content-import-state.json'));
  const [existingTitles, existingContents, workbookRows, generatedContentIds] = await Promise.all([readDataset(target), readDataset(contentTarget), readEssayWorkbookData(file), readContentImportState(state)]);
  const { records: titles, duplicates } = normalizeRows(workbookRows.titleRows);
  const { records: contents, warnings } = normalizeContentRows(workbookRows.contentRows, new Set(titles.map(({ id }) => id)));
  const change = analyzeEssayChange(existingTitles, titles);
  const contentChange = analyzeEssayContentChange(existingContents, contents);
  const runtimeOnlyContents = generatedContentIds.size ? existingContents.filter(({ contentId }) => !generatedContentIds.has(contentId)) : [];
  const contentGuardChange = analyzeEssayContentChange(
    generatedContentIds.size ? existingContents.filter(({ contentId }) => generatedContentIds.has(contentId)) : existingContents,
    contents,
  );
  const titleById = new Map(titles.map((title) => [title.id, title]));
  const compactContent = (list) => compactContents(list, titleById);
  await mkdir(path.dirname(report), { recursive: true });
  await writeFile(report, JSON.stringify({
    file: path.relative(root, file), titleRecords: titles.length, contentRecords: contents.length,
    duplicateTitleRecords: duplicates, contentWarnings: warnings,
    titles: compactChange(change, compactTitles), contents: compactChange(contentChange, compactContent),
    contentRemovalGuard: compactChange(contentGuardChange, compactContent), runtimeOnlyContents: compactContent(runtimeOnlyContents),
  }, null, 2) + '\n', 'utf8');
  printChange('Titles', change);
  printChange('Contents', contentChange);
  console.log(`Duplicate logical title records reported: ${duplicates.length}\nContent warnings: ${warnings.length}`);
  if (change.removed.length) console.warn(`Removed title records:\n${change.removed.map(({ id, title }) => `${id}  ${title}`).join('\n')}`);
  if (contentChange.removed.length) console.warn(`Removed content records:\n${compactContent(contentChange.removed).map(({ contentId, essayId, title }) => `${contentId}  ${essayId}  ${title}`).join('\n')}`);
  if (runtimeOnlyContents.length) console.warn(`Removing ${runtimeOnlyContents.length} runtime-only content record(s) not generated by the last Excel import.`);
  enforceRemovalGuard(change, { allowRemovals });
  enforceRemovalGuard(contentGuardChange, { allowRemovals });
  await mkdir(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(backupDirectory, `essay-titles-${stamp}.json`);
  const contentBackup = path.join(backupDirectory, `essay-contents-${stamp}.json`);
  await writeFile(backup, JSON.stringify(existingTitles, null, 2) + '\n', 'utf8');
  await writeFile(contentBackup, JSON.stringify(existingContents, null, 2) + '\n', 'utf8');
  const temporary = `${target}.tmp`, contentTemporary = `${contentTarget}.tmp`;
  await writeFile(temporary, JSON.stringify(titles, null, 2) + '\n', 'utf8');
  await writeFile(contentTemporary, JSON.stringify(contents, null, 2) + '\n', 'utf8');
  let titlesReplaced = false, contentsReplaced = false;
  try {
    await rename(temporary, target); titlesReplaced = true;
    await rename(contentTemporary, contentTarget); contentsReplaced = true;
  } catch (error) {
    if (titlesReplaced) await copyFile(backup, target);
    if (contentsReplaced) await copyFile(contentBackup, contentTarget);
    await Promise.all([unlink(temporary).catch(() => {}), unlink(contentTemporary).catch(() => {})]);
    throw error;
  }
  await writeFile(state, JSON.stringify({ generatedContentIds: contents.map(({ contentId }) => contentId) }, null, 2) + '\n', 'utf8');
  console.log(`Updated titles ${change.current} → ${titles.length}; contents ${contentChange.current} → ${contents.length}. Backups: ${path.relative(root, backup)}, ${path.relative(root, contentBackup)}`);
  return { records: titles, contents, duplicates, warnings, change, contentChange, backup, contentBackup };
}

const invokedDirectly = path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const value = (name) => args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
  const known = new Set(['--allow-removals', ...args.filter((argument) => /^--(?:file|target|content-target|report|state|backup-directory)=.+/.test(argument))]);
  if (args.some((argument) => !known.has(argument)))
    throw Error('Usage: npm run essays:update [-- --allow-removals] [--file=workbook.xlsx --target=essay-titles.json --content-target=essay-contents.json]');
  await importEssayTitles({
    file: value('--file') ? path.resolve(value('--file')) : masterWorkbook,
    target: value('--target') ? path.resolve(value('--target')) : runtimeDataset,
    contentTarget: value('--content-target') ? path.resolve(value('--content-target')) : runtimeContentDataset,
    report: value('--report') ? path.resolve(value('--report')) : importReport,
    state: value('--state') ? path.resolve(value('--state')) : contentImportState,
    backupDirectory: value('--backup-directory') ? path.resolve(value('--backup-directory')) : undefined,
    allowRemovals: args.includes('--allow-removals'),
  });
}
