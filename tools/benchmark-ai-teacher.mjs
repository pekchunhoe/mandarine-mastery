// Local/mock diagnostics only. This tool never constructs a Gemini SDK client,
// reads credentials, or sends network requests.
import { performance } from 'node:perf_hooks';
import { createTeacherHandler } from '../server/ai-handler.js';
import { createTutorLimiter, DEFAULT_CLIENT_RPM, DEFAULT_TOTAL_RPM } from '../server/ai-rate-limit.js';
import { selectGeminiModel, buildGenerationConfig } from '../server/gemini.js';

const sentence = {
  action: 'sentence_check', activity: 'sentenceBuilder',
  context: { topic: '坚持', situation: '运动会长跑比赛，同学们为我加油，我跑到了终点。', studentSentence: '我坚持跑到了终点。' },
};
const paragraph = {
  action: 'paragraph_review', activity: 'guidedEssay',
  context: { selectedTitle: '运动会', studentParagraph: '运动会上，同学们为我加油。我坚持跑到了终点。' },
};
const result = (input) => input.action === 'sentence_check'
  ? { status: 'correct', original: input.context.studentSentence, issues: [], styleSuggestions: [], suggestedRevision: '', studentTask: '读一读自己的句子。' }
  : { strengths: ['写出了长跑的结果。'], issues: [], missingDetails: [], revisionFocus: '可以写出听到加油后的感受。', studentTask: '自己选一个细节修改。' };
const request = (input) => new Request('http://localhost/api/gemini', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
});
let clock = 0;
const limiter = createTutorLimiter({ now: () => clock });
let accepted = 0, rejected = 0;
for (let index = 0; index < 20; index++) {
  clock = index * 3000;
  try { limiter.acquire(request(index % 2 ? sentence : paragraph))(); accepted++; }
  catch { rejected++; }
}
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const rows = [];
for (const input of [sentence, paragraph]) {
  let calls = 0;
  const timings = [];
  const endpoint = createTeacherHandler({
    env: { GEMINI_API_KEY: 'benchmark-mock-only' }, logger: { info() {}, warn() {} },
    limiter: createTutorLimiter({ perClient: 1000, total: 1000 }),
    generate: async () => { calls++; return JSON.stringify(result(input)); },
  });
  for (let index = 0; index < 110; index++) {
    const started = performance.now();
    const response = await endpoint(request(input));
    if (response.status !== 200) throw Error(`Unexpected local benchmark status: ${response.status}`);
    await response.arrayBuffer();
    if (index >= 10) timings.push(performance.now() - started);
  }
  rows.push({ action: input.action, activity: input.activity, samples: timings.length,
    model: selectGeminiModel(input.action, {}, input.activity).model,
    generationConfig: buildGenerationConfig(input),
    localMockP50Ms: Number(percentile(timings, .5).toFixed(3)),
    localMockP95Ms: Number(percentile(timings, .95).toFixed(3)), mockProviderAttempts: calls });
}
console.log(JSON.stringify({ measurement: 'LOCAL MOCK ONLY; zero upstream requests',
  configuredClientRpm: DEFAULT_CLIENT_RPM, configuredInstanceRpm: DEFAULT_TOTAL_RPM,
  admissionOverControlledMinute: { accepted, rejected }, rows }, null, 2));
