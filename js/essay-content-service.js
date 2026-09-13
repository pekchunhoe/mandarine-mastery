import records from '../data/essay-contents.json' with { type: 'json' };

const sortContents = (contents) => [...contents].sort((a, b) =>
  (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) || a.contentId.localeCompare(b.contentId));

export function getEssayContents({ essayId, level, active = true } = {}) {
  return sortContents(records.filter((content) =>
    (essayId == null || content.essayId === essayId) &&
    (level == null || content.level === level) &&
    (active == null || content.active === active)));
}

export const getEssayContentById = (contentId) => records.find((content) => content.contentId === contentId);
export const getEssayContentsByEssayId = (essayId) => getEssayContents({ essayId, active: null });
export const getActiveEssayContentsByEssayId = (essayId) => getEssayContents({ essayId });
export const getEssayContentsByLevel = (level) => getEssayContents({ level });
export const getPrimaryEssayContent = (essayId) => getActiveEssayContentsByEssayId(essayId)[0];
