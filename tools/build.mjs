import { mkdir, cp, readdir, writeFile, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import './prepare-vocabulary.mjs';
import { auditEssayCatalogue, normalizeRows, normalizeContentRows, readEssayWorkbookData, masterWorkbook } from './essay-title-import.mjs';
import { createVocabularyService } from '../js/vocabulary-service.js';
const root = fileURLToPath(new URL('..', import.meta.url)),
  out = path.join(root, 'dist');
const source = [
  'index.html',
  'icon.svg',
  'manifest.webmanifest',
  'styles',
  'js',
  'components',
  'activities',
  'data',
  'vendor',
  'templates',
];
const records = JSON.parse(await readFile(path.join(root, 'data/vocabulary.json'), 'utf8'));
if (!records.length) throw Error('Cannot build an empty vocabulary library');
createVocabularyService(records);
const workbook = await readEssayWorkbookData(masterWorkbook);
const sourceTitles = normalizeRows(workbook.titleRows).records;
const sourceContents = normalizeContentRows(workbook.contentRows, new Set(sourceTitles.map((title) => title.id))).records;
auditEssayCatalogue(sourceTitles, sourceContents, { expectedDistribution: { 1: 100, 2: 140, 3: 180, 4: 190, 5: 190, 6: 200 } });
for (const [name, expected] of [['essay-titles', sourceTitles], ['essay-contents', sourceContents]]) {
  if (JSON.stringify(JSON.parse(await readFile(path.join(root, `data/${name}.json`), 'utf8'))) !== JSON.stringify(expected)) throw Error(`Stale ${name}. Run npm run essays:update before building.`);
}
await mkdir(out, { recursive: true });
await rm(path.join(out, 'data', 'master-vocabulary.xlsx'), { force: true });
// Remove source workbooks left behind by older builds; ship generated data only.
for (const file of await readdir(path.join(out, 'data')).catch(() => [])) if (/\.xlsx$/i.test(file)) await rm(path.join(out, 'data', file), { force: true });
for (const name of source)
  await cp(path.join(root, name), path.join(out, name), {
    recursive: true,
    filter: (from) =>
      name !== 'data' || !/\.xlsx$/i.test(path.basename(from)),
  });
if (!(await readFile(path.join(out, 'data/vocabulary.json'))).equals(await readFile(path.join(root, 'data/vocabulary.json'))))
  throw Error('Production vocabulary differs from runtime vocabulary');
async function files(dir, prefix = '') {
  const list = [];
  for (const f of await readdir(dir, { withFileTypes: true })) {
    const p = prefix + f.name;
    if (f.isDirectory()) list.push(...(await files(path.join(dir, f.name), p + '/')));
    else list.push('./' + p);
  }
  return list;
}
const assets = (await files(out)).filter((x) => !['./sw.js', './version.json'].includes(x));
const template = await readFile(path.join(root, 'sw.js'), 'utf8');
const digest = createHash('sha256');
for (const file of assets.sort()) digest.update(await readFile(path.join(out, file)));
const cacheName = `huawen-lab-${digest.digest('hex').slice(0, 12)}`;
const versionModule = path.join(out, 'js', 'deployment-version.js');
await writeFile(
  versionModule,
  (await readFile(versionModule, 'utf8')).replace('__BUILD_VERSION__', cacheName),
);
await writeFile(path.join(out, 'version.json'), `${JSON.stringify({ version: cacheName })}\n`);
await writeFile(
  path.join(out, 'sw.js'),
  template
    .replace(/const ASSETS = .*?;/s, `const ASSETS = ${JSON.stringify(assets)};`)
    .replace(/const CACHE = .*?;/, `const CACHE = '${cacheName}';`),
);
console.log(
  `Built ${assets.length} static assets in dist. Vocabulary: ${records.length}. AI uses the optional /api/gemini function.`,
);
