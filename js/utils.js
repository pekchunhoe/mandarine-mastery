export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const escapeHTML = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const normalize = (value) => String(value ?? '').replace(/[\s\p{P}\p{S}]/gu, '');
export const shuffle = (array) => {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
export const unique = (array, key = (x) => x) => [
  ...new Map(array.map((x) => [key(x), x])).values(),
];
export const dayKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const prettyGrade = (grade) =>
  /^[1-6]$/.test(String(grade)) ? '一二三四五六'[Number(grade) - 1] + '年级' : '混合复习';
export function highlight(text, words) {
  const list = unique(words.filter(Boolean)).sort((a, b) => b.length - a.length);
  if (!list.length) return escapeHTML(text);
  const pattern = new RegExp(
    `(${list.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'g',
  );
  return String(text)
    .split(pattern)
    .map((s) => (list.includes(s) ? `<mark>${escapeHTML(s)}</mark>` : escapeHTML(s)))
    .join('');
}
export function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3200);
}
export const button = (text, action, cls = 'btn', extra = '') =>
  `<button type="button" class="${cls}" data-action="${action}" ${extra}>${text}</button>`;
export function download(name, content, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
