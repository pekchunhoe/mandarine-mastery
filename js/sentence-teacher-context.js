import { CUSTOM_SENTENCE_SCENARIO } from '../data/sentence-scenarios.js';
import { modelSentences } from './sentence-keyword.js';

// Read the existing scenario controls; situation remains the only wire field.
export function buildSentenceTeacherContext({ activeKeyword, keywordMode, situation, customSituation, studentSentence, studentYearLevel }) {
  const context = {
    topic: activeKeyword,
    keywordMode,
    situation: (situation === CUSTOM_SENTENCE_SCENARIO ? customSituation : situation)?.trim() || '',
    studentSentence,
  };
  const year = Number(studentYearLevel);
  if (Number.isInteger(year) && year >= 1 && year <= 6) context.studentYearLevel = year;
  return context;
}

// New activity snapshots carry mode metadata; retain older clients' response
// contracts while serving the richer sentence-only schema to this activity.
export const usesScenarioTeaching = (input) => input.activity === 'sentenceBuilder' &&
  ['builtin', 'custom'].includes(input.context?.keywordMode);

// These guards detect a few explicit incompatible claims, not semantic relevance.
// No overlap score is used to certify an example. Ambiguous cases are left to
// the scenario-grounded tutor and the student's/teacher's review.
export function sentenceScenarioIssue(text, scenario, keyword = '') {
  if (!scenario?.trim() || typeof text !== 'string') return null;
  for (const sentence of modelSentences(text, keyword)) {
    const issue = scenarioSentenceIssue(sentence, scenario, keyword);
    if (issue) return issue;
  }
  return null;
}

function scenarioSentenceIssue(text, scenario, keyword) {
  const content = keyword ? text.split(keyword).join('') : text;
  const running = /长跑|马拉松|接力赛|赛跑|跑步比赛|跑到[了过]?终点/u.test(scenario);
  if (running) {
    const routines = [
      { context: /作业|功课/u, output: /(?:每天|天天|每日)?(?:完成|做|写)(?:家庭)?(?:作业|功课)/u },
      { context: /钢琴|练琴/u, output: /(?:每天|天天|每日)?(?:练习)?(?:弹钢琴|练琴)/u },
      { context: /学习|读书/u, output: /(?:每天|天天|每日)?学习/u },
    ];
    // Only standalone routine models with no running event, no contrast or
    // hypothetical wording are rejected. Mentioning family cheering is fine.
    if (!/跑|终点|比赛|加油|同学|如果|假如|想起|以前|不是|并非/u.test(content) &&
        routines.some(({ context, output }) => !context.test(scenario) && output.test(content)))
      return 'unrelated_routine';
    const finished = /(?:终于|最终|最后|成功|坚持).{0,6}(?:跑到|到达|抵达)了?终点/u.test(scenario);
    if (finished && /(?:没有|没能|未能)(?:跑到|到达|抵达)终点|(?:最后|最终|结果)[，,\s]*(?:我|他|她|我们)?(?:却|就)?放弃了?(?:比赛|长跑)/u.test(content))
      return 'contradictory_finish';
  }
  const days = [...new Set(scenario.match(/星期[一二三四五六日天]/gu) || [])]
    .map((day) => day.replace('天', '日'));
  const openingDay = content.match(/^[“「"\s]*(?:在)?(星期[一二三四五六日天])/u)?.[1]?.replace('天', '日');
  if (days.length === 1 && openingDay && openingDay !== days[0]) return 'contradictory_day';
  return null;
}
