import { fields, normalizeRecord } from './vocabulary-schema.js';
const DB = 'huawen-vocabulary',
  KEY = 'teacher-overlay';
const serial = (w) =>
  Object.fromEntries(
    fields.map((f) => [
      f,
      f === 'character'
        ? (w.sourceCharacter ?? w.character ?? '')
        : (w[f] ?? (['lesson', 'difficulty'].includes(f) ? null : '')),
    ]),
  );
let bundled = [],
  overlay = null;
export let localLibraryNotice = '';
function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('settings');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(Error('Close other app tabs and retry / 请关闭其他页面后重试'));
  });
}
async function transaction(mode, value) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('settings', mode),
        store = tx.objectStore('settings');
      const r =
        mode === 'readonly'
          ? store.get(KEY)
          : value === null
            ? store.delete(KEY)
            : store.put(value, KEY);
      tx.oncomplete = () => resolve(r.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export function overlayWords(base, change) {
  if (!change) return base;
  if (change.version !== 1 || !Array.isArray(change.upserts) || !Array.isArray(change.deleted))
    throw Error('Invalid local library');
  const result = new Map(base.map((w) => [w.id, w]));
  for (const id of change.deleted) result.delete(id);
  const ids = new Set();
  for (const raw of change.upserts) {
    const w = normalizeRecord(raw).record;
    if (ids.has(w.id)) throw Error('Duplicate local ID');
    ids.add(w.id);
    result.set(w.id, w);
  }
  return [...result.values()];
}
export async function loadLibraryData() {
  const response = await fetch('./data/vocabulary.json');
  if (!response.ok) throw Error('词语资料暂时无法载入');
  const raw = await response.json();
  if (!Array.isArray(raw) || !raw.length) throw Error('词语资料为空或格式错误');
  bundled = raw.map((w) => normalizeRecord(w).record);
  const ids = new Set(bundled.map((w) => w.id));
  if (ids.size !== bundled.length) throw Error('词语资料含重复编号');
  try {
    overlay = await transaction('readonly');
    return overlayWords(bundled, overlay);
  } catch {
    localLibraryNotice =
      '本机词库未能读取；已载入发布词库。本机资料未被删除。请导出备份或检查浏览器储存权限。';
    return bundled;
  }
}
export async function saveLocalLibrary(records) {
  const clean = records.map((w) => normalizeRecord(serial(w)).record),
    base = new Map(bundled.map((w) => [w.id, w]));
  if (new Set(clean.map((w) => w.id)).size !== clean.length) throw Error('Duplicate ID');
  const ids = new Set(clean.map((w) => w.id));
  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    deleted: bundled.filter((w) => !ids.has(w.id)).map((w) => w.id),
    upserts: clean.filter((w) => JSON.stringify(w) !== JSON.stringify(base.get(w.id))),
  };
  await transaction('readwrite', next);
  overlay = next;
  return clean;
}
export async function restoreBundledLibrary() {
  await transaction('readwrite', null);
  overlay = null;
  return bundled;
}
export const libraryStatus = () => ({
  bundled: bundled.length,
  local: !!overlay,
  updatedAt: overlay?.updatedAt,
});
export const exportRecords = (records) => records.map(serial);
