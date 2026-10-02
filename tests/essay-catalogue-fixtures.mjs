import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { masterWorkbook, readEssayWorkbookData, normalizeRows, normalizeContentRows } from '../tools/essay-title-import.mjs';

export const distribution = { 1: 100, 2: 140, 3: 180, 4: 190, 5: 190, 6: 200 };
const workbook = await readEssayWorkbookData(masterWorkbook);
export const titles = normalizeRows(workbook.titleRows).records;
export const contents = normalizeContentRows(workbook.contentRows, new Set(titles.map((title) => title.id))).records;
const legacy = JSON.parse(await readFile(new URL('../docs/essay-title-backups/essay-titles-2026-10-02T02-23-24-820Z.json', import.meta.url), 'utf8'));
export const legacyIds = new Set(legacy.map((title) => title.id));
export const added = titles.filter((title) => !legacyIds.has(title.id));
assert.equal(legacyIds.size, 300);
assert.equal(added.length, 700);
// Establish new/legacy membership by stable ID, never by array position.
export const newByGrade = Object.keys(distribution).map((grade) => added.find((title) => title.grade === Number(grade)));
assert.ok(newByGrade.every(Boolean));
// Separately exercise the physical end of the workbook, before any runtime sorting.
export const tail = workbook.titleRows.slice(-3).map(({ raw }) => titles.find((title) => title.id === raw.id));
export const samples = [...new Map([...newByGrade, ...tail].map((title) => [title.id, title])).values()];
export const modelFor = (title) => contents.find((content) => content.essayId === title.id && content.active);
export const matching = (filters = {}) => titles.filter((title) => {
  if (!title.active || !modelFor(title)) return false;
  for (const key of ['grade', 'category', 'theme', 'essayType', 'difficulty']) {
    if (filters[key] && String(title[key]) !== String(filters[key])) return false;
  }
  const query = (filters.search || '').trim().toLowerCase();
  return !query || [title.title, title.category, title.theme, ...title.suggestedKeywords].join(' ').toLowerCase().includes(query);
}).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
