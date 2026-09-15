import { state, persist } from './state.js';

// Activity snapshots bridge a temporary full-page helper visit. They are kept in
// memory first, then best-effort persisted through the application's state store.
const memorySnapshots = new Map();
let snapshotState = state;
const MAX_SNAPSHOTS = 8;
let pendingHelperTarget = null;

const activityRoute = (route) => typeof route === 'string' && /^#activity\/[a-zA-Z0-9_-]+(?:\?.*)?$/.test(route);
const now = () => Date.now();
const contextStore = () => {
  if (snapshotState !== state) {
    memorySnapshots.clear();
    pendingHelperTarget = null;
    snapshotState = state;
  }
  state.activityContext ||= { returnContext: null, snapshots: {} };
  state.activityContext.snapshots ||= {};
  return state.activityContext;
};

export function activitySnapshot(route) {
  if (!activityRoute(route)) return null;
  const store = contextStore();
  return memorySnapshots.get(route) || store.snapshots[route] || null;
}

export function saveActivitySnapshot(route, snapshot) {
  if (!activityRoute(route) || !snapshot || typeof snapshot !== 'object') return;
  const record = { ...snapshot, route, updatedAt: now() };
  memorySnapshots.set(route, record);
  const store = contextStore();
  store.snapshots[route] = record;
  const entries = Object.entries(store.snapshots).sort(([, a], [, b]) => (b.updatedAt || 0) - (a.updatedAt || 0));
  for (const [staleRoute] of entries.slice(MAX_SNAPSHOTS)) delete store.snapshots[staleRoute];
  persist();
}

export function captureActivityScroll(route) {
  const snapshot = activitySnapshot(route);
  if (snapshot) saveActivitySnapshot(route, { ...snapshot, scrollPosition: globalThis.scrollY || 0 });
}

export function clearActivitySnapshot(route) {
  if (!activityRoute(route)) return;
  memorySnapshots.delete(route);
  delete contextStore().snapshots[route];
  persist();
}

export function openTemporaryHelper({ helperType = 'reference', helperLabel = '学习工具', target } = {}) {
  const sourceRoute = globalThis.location?.hash || '';
  if (!activityRoute(sourceRoute)) return false;
  captureActivityScroll(sourceRoute);
  const snapshot = activitySnapshot(sourceRoute);
  contextStore().returnContext = {
    sourceRoute,
    sourceActivity: snapshot?.activityId || sourceRoute.split('/')[1]?.split('?')[0],
    sourceLabel: snapshot?.activityName || '练习',
    helperType,
    helperLabel,
    timestamp: now(),
  };
  pendingHelperTarget = target || null;
  persist();
  return true;
}

export function returnContext() {
  const value = contextStore().returnContext;
  if (!value || !activityRoute(value.sourceRoute) || now() - value.timestamp > 12 * 60 * 60 * 1000) {
    if (value) {
      contextStore().returnContext = null;
      persist();
    }
    return null;
  }
  return value;
}

// A helper transition keeps its return context. Any other route change clears
// it, preventing an old destination from leaking into a later activity.
export function observeRouteChange(nextRoute) {
  const context = returnContext();
  const expectedHelper = pendingHelperTarget && nextRoute === pendingHelperTarget;
  pendingHelperTarget = null;
  if (expectedHelper || !context) return;
  contextStore().returnContext = null;
  persist();
}
