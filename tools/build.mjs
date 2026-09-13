import { mkdir, cp, readdir, writeFile, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import './prepare-vocabulary.mjs';
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
await mkdir(out, { recursive: true });
await rm(path.join(out, 'data', 'master-vocabulary.xlsx'), { force: true });
await rm(path.join(out, 'data', 'master-essay-titles.xlsx'), { force: true });
for (const name of source)
  await cp(path.join(root, name), path.join(out, name), {
    recursive: true,
    filter: (from) =>
      name !== 'data' || !['master-vocabulary.xlsx', 'master-essay-titles.xlsx'].includes(path.basename(from)),
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
const assets = (await files(out)).filter((x) => x !== './sw.js');
const template = await readFile(path.join(root, 'sw.js'), 'utf8');
const digest = createHash('sha256');
for (const file of assets.sort()) digest.update(await readFile(path.join(out, file)));
const cacheName = `huawen-lab-${digest.digest('hex').slice(0, 12)}`;
await writeFile(
  path.join(out, 'sw.js'),
  template
    .replace(/const ASSETS = .*?;/s, `const ASSETS = ${JSON.stringify(assets)};`)
    .replace(/const CACHE = .*?;/, `const CACHE = '${cacheName}';`),
);
console.log(
  `Built ${assets.length} static assets in dist. Vocabulary: ${records.length}. No backend required.`,
);
