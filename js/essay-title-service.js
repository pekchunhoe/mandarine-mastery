import records from '../data/essay-titles.json' with { type: 'json' };

// Category groups are display/filter configuration, not essay-title content.
const categoryGroups = Object.freeze({
  生活: ['我的生活', '节日生日'], 家庭: ['家庭'], 学校: ['学校生活'], 人物: ['人物', '朋友'],
  经历: ['难忘经历', '帮助别人'], 活动: ['比赛运动', '学校活动', '合作'],
  自然: ['户外自然', '动物', '环保'], 成长: ['成长责任'], 想象: ['想象', '看图作文'],
});
const groupedCategories = new Set(Object.values(categoryGroups).flat());
// Existing broad groups stay first; new Excel-only categories gain a direct filter automatically.
export const essayCategories = Object.freeze([
  '全部', '生活', '家庭', '学校', '人物', '经历', '活动', '自然', '成长', '想象',
  ...[...new Set(records.map((record) => record.category))]
    .filter((category) => !groupedCategories.has(category))
    .sort((a, b) => a.localeCompare(b, 'zh-Hans')),
]);
const sortTitles = (titles) => [...titles].sort((a, b) =>
  (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));
const includes = (value, filter) => !filter || value === filter;

export function getEssayTitles({ grade, category, theme, essayType, difficulty, activityTag, active = true } = {}) {
  const selectedGrade = grade == null || grade === '' ? null : Number(grade);
  return sortTitles(records.filter((title) =>
    (active == null || title.active === active) &&
    (!selectedGrade || (title.gradeMin <= selectedGrade && title.gradeMax >= selectedGrade)) &&
    includes(title.category, category) && includes(title.theme, theme) && includes(title.essayType, essayType) &&
    (difficulty == null || difficulty === '' || Number(title.difficulty) === Number(difficulty)) &&
    (!activityTag || title.activityTags.includes(activityTag))));
}
export function getEssayTitleById(id) { return records.find((title) => title.id === id); }
export const getActiveEssayTitles = () => getEssayTitles();
export const getEssayTitlesByGrade = (grade) => getEssayTitles({ grade });
export const getEssayTitlesByCategory = (category) => getEssayTitles({ category });
export const getEssayTitlesByType = (essayType) => getEssayTitles({ essayType });
export const topicMatchesCategory = (topic, filter = '全部') =>
  filter === '全部' || categoryGroups[filter]?.includes(topic.category) || topic.category === filter;
// Compatibility exports keep existing activity code and integrations stable.
export const essayTopics = Object.freeze(getEssayTitles());
export const topicsForGrade = getEssayTitlesByGrade;
