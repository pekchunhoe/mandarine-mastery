import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { masterWorkbook, readEssayWorkbookData, normalizeRows, normalizeContentRows, auditEssayCatalogue } from './essay-title-import.mjs';

// Read-only delivery check. Never reloads the app or changes browser/site data.
// Run the browser suite separately to verify actual selectors and search.
const args = process.argv.slice(2);
const base = new URL(args.find((arg) => arg.startsWith('--url='))?.slice(6) || 'https://mandarine-mastery.vercel.app/');
const output = args.find((arg) => arg.startsWith('--output='))?.slice(9);
const workbook = await readEssayWorkbookData(masterWorkbook);
const titles = normalizeRows(workbook.titleRows).records;
const contents = normalizeContentRows(workbook.contentRows, new Set(titles.map((title) => title.id))).records;
const expectedDistribution = { 1: 100, 2: 140, 3: 180, 4: 190, 5: 190, 6: 200 };
auditEssayCatalogue(titles, contents, { expectedDistribution });
const report = { url: base.href, checkedAt: new Date().toISOString(), assets: [], checks: [] };
const bodies = new Map();
const paths = ['version.json', 'index.html', 'sw.js', 'js/deployment-version.js', 'js/essay-title-service.js', 'js/essay-content-service.js', 'activities/essayTraining.js', 'data/essay-titles.json', 'data/essay-contents.json'];
await Promise.all(paths.map(async (path) => {
  try {
    const response = await fetch(new URL(path, base), { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    const body = await response.text();
    report.assets.push({ path, status: response.status, sha256: createHash('sha256').update(body).digest('hex'), headers: Object.fromEntries(response.headers) });
    if (!response.ok) throw Error(`${path}: HTTP ${response.status}`);
    bodies.set(path, body);
  } catch (error) {
    report.checks.push({ name: `fetch ${path}`, pass: false, detail: error.message });
  }
}));
function check(name, run) {
  try { const detail = run(); report.checks.push({ name, pass: true, ...(detail ? { detail } : {}) }); }
  catch (error) { report.checks.push({ name, pass: false, detail: error.message }); }
}
const delivered = {};
for (const [name, expected] of [['essay-titles', titles], ['essay-contents', contents]]) {
  check(`${name} matches workbook`, () => {
    const actual = JSON.parse(bodies.get(`data/${name}.json`));
    delivered[name] = actual;
    report[name] = { count: actual.length, active: actual.filter((row) => row.active).length };
    assert.equal(actual.length, expected.length, `Expected ${expected.length} ${name}, received ${actual.length}`);
    assert.ok(JSON.stringify(actual) === JSON.stringify(expected), `${name} differs from the workbook (IDs, metadata or full content)`);
  });
}
check('joined active catalogue and Standard totals', () => {
  const activeContents = new Set(delivered['essay-contents'].filter((row) => row.active).map((row) => row.essayId));
  const joined = delivered['essay-titles'].filter((row) => row.active && activeContents.has(row.id));
  report.joinedCount = joined.length;
  report.distribution = Object.fromEntries(Object.keys(expectedDistribution).map((grade) => [grade, joined.filter((row) => Number(row.grade) === Number(grade)).length]));
  assert.equal(new Set(joined.map((row) => row.id)).size, 1000);
  assert.deepEqual(report.distribution, expectedDistribution);
});
check('version.json, loaded version module and Service Worker agree', () => {
  const version = JSON.parse(bodies.get('version.json')).version;
  report.version = version;
  assert.match(version, /^huawen-lab-[a-f0-9]{12}$/);
  assert.equal(bodies.get('js/deployment-version.js')?.match(/const BUILD_VERSION = '([^']+)'/)?.[1], version);
  assert.equal(bodies.get('sw.js')?.match(/const CACHE = '([^']+)'/)?.[1], version);
});
check('Service Worker includes both datasets', () => {
  const assets = JSON.parse(bodies.get('sw.js')?.match(/const ASSETS = (\[[\s\S]*?\]);/)?.[1]);
  for (const name of ['essay-titles', 'essay-contents']) assert.ok(assets.includes(`./data/${name}.json`));
});
// Compare deployed application code as well as data, detecting an old or mixed release.
for (const path of ['index.html', 'js/essay-title-service.js', 'js/essay-content-service.js', 'activities/essayTraining.js']) {
  const expected = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  check(`${path} matches local source`, () => assert.equal(bodies.get(path)?.replace(/\r\n/g, '\n') === expected.replace(/\r\n/g, '\n'), true, `${path} is from a different source revision`));
}
report.assets.sort((a, b) => a.path.localeCompare(b.path));
report.pass = report.checks.every((item) => item.pass);
if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ url: report.url, version: report.version, titles: report['essay-titles'], contents: report['essay-contents'], joinedCount: report.joinedCount, distribution: report.distribution, checks: report.checks, pass: report.pass }, null, 2));
if (!report.pass) process.exitCode = 1;
