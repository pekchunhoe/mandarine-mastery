import { loadState, saveState, freshState } from './storage.js';
import { recordAttempt, aggregate, isWeak } from './mastery.js';
import { toast, unique } from './utils.js';
import { vocabularyService } from './vocabulary-service.js';
import { clearEssayVocabularyCache } from './essay-vocabulary-service.js';
import { loadLibraryData, saveLocalLibrary, restoreBundledLibrary } from './vocabulary-store.js';
export let state = loadState();
export let vocabulary = [];
export async function loadVocabulary() {
  vocabularyService.setWords(await loadLibraryData());
  clearEssayVocabularyCache();
  vocabulary = vocabularyService.getAllWords();
  if (
    state.settings.lesson !== 'all' &&
    !vocabulary.some(
      (w) =>
        (state.settings.grade === 'mixed' || String(w.grade) === state.settings.grade) &&
        w.lesson === state.settings.lesson,
    )
  ) {
    state.settings.lesson = 'all';
    persist();
  }
}
export async function changeLocalVocabulary(records) {
  const clean = await saveLocalLibrary(records);
  vocabularyService.setWords(clean);
  clearEssayVocabularyCache();
  vocabulary = vocabularyService.getAllWords();
}
export async function resetLocalVocabulary() {
  vocabularyService.setWords(await restoreBundledLibrary());
  clearEssayVocabularyCache();
  vocabulary = vocabularyService.getAllWords();
}
let saveWarning = false;
export function persist() {
  const ok = saveState(state);
  if (!ok && !saveWarning) {
    toast('储存空间不足或未获允许。请导出记录，避免遗失。');
    saveWarning = true;
  }
  return ok;
}
export function setSettings(settings) {
  Object.assign(state.settings, settings);
  persist();
}
export function filteredWords() {
  return vocabularyService.getWordsForActivity({
    ...state.settings,
    difficulty: state.settings.wordDifficulty,
  });
}
export function attempt(item, kind, correct, options) {
  const result = recordAttempt(state, item, kind, correct, options);
  updateBadges();
  persist();
  return result;
}
export function updateBadges() {
  const records = unique(vocabulary, (x) => x.word).map((w) => aggregate(state, w.word));
  const rules = [
    ['🌱 初识50词', records.filter((r) => r.seen).length >= 50],
    ['🧩 句子建筑师', records.reduce((n, r) => n + r.guided, 0) >= 5],
    ['✍️ 造句达人', records.filter((r) => r.sentenceSuccess).length >= 10],
    ['📚 段落高手', records.filter((r) => r.paragraphSuccess).length >= 5],
    ['🏆 作文词语王', records.filter((r) => r.reviewed).length >= 10],
  ];
  for (const [name, earned] of rules)
    if (earned && !state.badges.includes(name)) {
      state.badges.push(name);
      toast(`获得徽章：${name}`);
    }
}
export function weakWords() {
  return unique(filteredWords(), (x) => x.word).filter((w) => isWeak(aggregate(state, w.word)));
}
export function resetProgress() {
  state = freshState();
  persist();
}
export function replaceState(next) {
  state = next;
  persist();
}
export function addTray(id) {
  state.tray = unique([...state.tray, id]).slice(-12);
  persist();
}
