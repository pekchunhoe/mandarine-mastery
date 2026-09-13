import { escapeHTML as e } from '../js/utils.js';
export const connectorTasks = [
  {
    first: '天突然下起大雨。',
    second: '，我们赶快跑到凉亭避雨。',
    options: ['于是', '虽然', '不但'],
    answer: ['于是'],
    reason: '“于是”连接前面发生的事和随后的行动。',
  },
  {
    first: '我们',
    second: '遇到了困难，但是谁也没有放弃。',
    options: ['虽然', '最后', '接着'],
    answer: ['虽然'],
    reason: '“虽然……但是……”表示情况有困难，结果却仍然坚持。',
  },
  {
    first: '',
    second: '雨下得很大，所以比赛改在礼堂举行。',
    options: ['因为', '不但', '最后'],
    answer: ['因为'],
    reason: '“因为……所以……”把原因和结果连起来。',
  },
  {
    first: '姐姐',
    second: '会唱歌，而且会弹钢琴。',
    options: ['不但', '因为', '终于'],
    answer: ['不但'],
    reason: '“不但……而且……”把两项本领联系起来，后一项更进一步。',
  },
  {
    first: '准备三明治时，',
    second: '把面包放在盘子上，接着铺上蔬菜和鸡蛋。',
    options: ['首先', '因此', '虽然'],
    answer: ['首先'],
    reason: '“首先”交代制作过程的第一步。',
  },
  {
    first: '我们排练了很多次，今天',
    second: '顺利完成了表演。',
    options: ['终于', '虽然', '因为'],
    answer: ['终于'],
    reason: '“终于”表示经过一段时间或努力后，期待的结果实现了。',
  },
];
export function connectors(root, ctx) {
  const task = connectorTasks[ctx.round % connectorTasks.length];
  root.innerHTML = `<h2>用连接词，把意思接起来</h2><p class="sentence-display">${e(task.first)}<span class="blank">？</span>${e(task.second)}</p><div class="answer-grid">${task.options.map((w) => `<button class="word-chip" data-connector="${w}">${w}</button>`).join('')}</div><details><summary>连接词小工具箱</summary><p>先后：首先、接着、然后、后来、最后</p><p>变化：突然、于是、终于</p><p>原因与结果：因为……所以……、因此</p><p>不同的情况：虽然……但是……</p><p>再进一层：不但……而且……</p></details>`;
  root.addEventListener(
    'click',
    (event) => {
      const b = event.target.closest('[data-connector]');
      if (!b || ctx.finished) return;
      if (task.answer.includes(b.dataset.connector))
        ctx.complete({
          kind: 'context',
          items: [],
          answer: b.dataset.connector,
          message: `${task.first}${b.dataset.connector}${task.second} ${task.reason}`,
        });
      else ctx.note('读读前后两部分，是先后、原因、结果，还是转折？');
    },
    { signal: ctx.signal },
  );
}
