export const STORAGE_KEY = 'huawen-lab-v1';
export function freshState() {
  return {
    version: 1,
    settings: {
      grade: '3',
      lesson: 'all',
      category: 'all',
      wordDifficulty: 'all',
      tag: 'all',
      essayTopic: 'all',
      difficulty: 'easy',
      count: 5,
      timed: false,
      hints: true,
      projection: false,
    },
    records: {},
    history: [],
    drafts: {},
    favorites: [],
    tray: [],
    recent: [],
    days: [],
    xp: 0,
    badges: [],
    credits: {},
    activityContext: { returnContext: null, snapshots: {} },
  };
}
// Reject malformed nested data; retain a backup of unreadable saves before recovery.
export function hydrate(raw) {
  const base = freshState();
  if (!raw || raw.version !== 1) return base;
  if (raw.settings && typeof raw.settings === 'object') {
    for (const [key, allowed] of Object.entries({
      grade: ['1', '2', '3', '4', '5', '6', 'mixed'],
      difficulty: ['easy', 'medium', 'hard'],
    }))
      if (allowed.includes(raw.settings[key])) base.settings[key] = raw.settings[key];
    if (typeof raw.settings.lesson === 'string') base.settings.lesson = raw.settings.lesson;
    for (const k of ['category', 'wordDifficulty', 'tag', 'essayTopic'])
      if (typeof raw.settings[k] === 'string') base.settings[k] = raw.settings[k];
    base.settings.count = Math.max(1, Math.min(20, Number(raw.settings.count) || 5));
    for (const k of ['timed', 'hints', 'projection'])
      if (typeof raw.settings[k] === 'boolean') base.settings[k] = raw.settings[k];
  }
  for (const k of ['favorites', 'tray', 'recent', 'days', 'badges'])
    if (Array.isArray(raw[k])) base[k] = raw[k].filter((x) => typeof x === 'string').slice(-1000);
  if (Array.isArray(raw.history))
    base.history = raw.history
      .filter((x) => x && typeof x.word === 'string' && typeof x.at === 'string')
      .slice(-2000);
  if (raw.records && typeof raw.records === 'object')
    for (const [k, v] of Object.entries(raw.records)) {
      if (v && typeof v === 'object' && typeof v.word === 'string') {
        base.records[k] = { ...v };
        for (const field of [
          'seen',
          'correct',
          'incorrect',
          'recognition',
          'context',
          'recall',
          'guided',
          'sentenceSuccess',
          'paragraphSuccess',
          'reviewed',
          'mastery',
        ])
          base.records[k][field] = Math.max(0, Number(v[field]) || 0);
        base.records[k].mastery = Math.min(100, base.records[k].mastery);
        for (const field of ['lastPractised', 'lastCorrect', 'due'])
          base.records[k][field] =
            typeof v[field] === 'string' && Number.isFinite(Date.parse(v[field])) ? v[field] : null;
        base.records[k].lastError =
          v.lastError &&
          typeof v.lastError.at === 'string' &&
          Number.isFinite(Date.parse(v.lastError.at))
            ? {
                at: v.lastError.at,
                kind: String(v.lastError.kind || 'context'),
                message: String(v.lastError.message || '需要再练习'),
                answer: String(v.lastError.answer || ''),
              }
            : null;
        base.records[k].selfRating = ['easy', 'practice', 'hard'].includes(v.selfRating)
          ? v.selfRating
          : null;
      }
    }
  if (raw.drafts && typeof raw.drafts === 'object')
    for (const [k, v] of Object.entries(raw.drafts))
      if (v && typeof v === 'object' && typeof v.text === 'string')
        base.drafts[k] = {
          ...v,
          plan:
            v.plan && typeof v.plan === 'object'
              ? Object.fromEntries(Object.entries(v.plan).filter(([, x]) => typeof x === 'string'))
              : {},
          order: Array.isArray(v.order) ? v.order.filter((x) => typeof x === 'string') : [],
          lines: Array.isArray(v.lines) ? v.lines.filter((x) => typeof x === 'string') : [],
          checklist:
            v.checklist && typeof v.checklist === 'object'
              ? Object.fromEntries(
                  Object.entries(v.checklist).filter(([, x]) => typeof x === 'boolean'),
                )
              : {},
          targetIds: Array.isArray(v.targetIds)
            ? v.targetIds.filter((x) => typeof x === 'string')
            : [],
        };
  if (raw.credits && typeof raw.credits === 'object')
    base.credits = Object.fromEntries(
      Object.entries(raw.credits).filter(([, v]) => typeof v === 'string'),
    );
  if (raw.activityContext && typeof raw.activityContext === 'object') {
    const context = raw.activityContext.returnContext;
    if (context && typeof context === 'object' && typeof context.sourceRoute === 'string' && /^#activity\/[a-zA-Z0-9_-]+(?:\?.*)?$/.test(context.sourceRoute) && typeof context.timestamp === 'number')
      base.activityContext.returnContext = {
        sourceRoute: context.sourceRoute,
        sourceActivity: typeof context.sourceActivity === 'string' ? context.sourceActivity : '',
        sourceLabel: typeof context.sourceLabel === 'string' ? context.sourceLabel.slice(0, 80) : '练习',
        helperType: typeof context.helperType === 'string' ? context.helperType.slice(0, 80) : 'reference',
        helperLabel: typeof context.helperLabel === 'string' ? context.helperLabel.slice(0, 80) : '学习工具',
        timestamp: context.timestamp,
      };
    if (raw.activityContext.snapshots && typeof raw.activityContext.snapshots === 'object')
      for (const [route, snapshot] of Object.entries(raw.activityContext.snapshots))
        if (/^#activity\/[a-zA-Z0-9_-]+(?:\?.*)?$/.test(route) && snapshot && typeof snapshot === 'object' && typeof snapshot.activityId === 'string')
          base.activityContext.snapshots[route] = {
            activityId: snapshot.activityId.slice(0, 80),
            activityName: typeof snapshot.activityName === 'string' ? snapshot.activityName.slice(0, 120) : '练习',
            queueIds: Array.isArray(snapshot.queueIds) ? snapshot.queueIds.filter((x) => typeof x === 'string').slice(0, 50) : [],
            round: Math.max(0, Number(snapshot.round) || 0), step: Math.max(0, Number(snapshot.step) || 0),
            sessionSuccess: Math.max(0, Number(snapshot.sessionSuccess) || 0), sessionMistakes: Math.max(0, Number(snapshot.sessionMistakes) || 0), sessionSkipped: Math.max(0, Number(snapshot.sessionSkipped) || 0), sessionXP: Math.max(0, Number(snapshot.sessionXP) || 0),
            remaining: Math.max(0, Number(snapshot.remaining) || 0), scrollPosition: Math.max(0, Number(snapshot.scrollPosition) || 0), updatedAt: Math.max(0, Number(snapshot.updatedAt) || 0),
          };
  }
  base.xp = Math.max(0, Number(raw.xp) || 0);
  return base;
}
export function loadState(storage) {
  try {
    storage ||= globalThis.localStorage;
    return hydrate(JSON.parse(storage.getItem(STORAGE_KEY)));
  } catch {
    try {
      const old = storage.getItem(STORAGE_KEY);
      if (old) storage.setItem(`${STORAGE_KEY}-recovery`, old);
    } catch {
      /* Private mode can disallow all storage. */
    }
    return freshState();
  }
}
export function saveState(state, storage) {
  try {
    storage ||= globalThis.localStorage;
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
