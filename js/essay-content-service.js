import records from '../data/essay-contents.json' with { type: 'json' };
const contentById = new Map(records.map((record) => [record.contentId, record]));
const contentsByEssayId = new Map();
for (const record of records) {
  if (!contentsByEssayId.has(record.essayId)) contentsByEssayId.set(record.essayId, []);
  contentsByEssayId.get(record.essayId).push(record);
}

const sortContents = (contents) => [...contents].sort((a, b) =>
  (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) || a.contentId.localeCompare(b.contentId));

export function getEssayContents({ essayId, level, active = true } = {}) {
  return sortContents((essayId == null ? records : contentsByEssayId.get(essayId) || []).filter((content) =>
    (essayId == null || content.essayId === essayId) &&
    (level == null || content.level === level) &&
    (active == null || content.active === active)));
}

export const getEssayContentById = (contentId) => contentById.get(contentId);
export const getEssayContentsByEssayId = (essayId) => getEssayContents({ essayId, active: null });
export const getActiveEssayContentsByEssayId = (essayId) => getEssayContents({ essayId });
export const getEssayContentsByLevel = (level) => getEssayContents({ level });
export const getPrimaryEssayContent = (essayId) => getActiveEssayContentsByEssayId(essayId)[0];
