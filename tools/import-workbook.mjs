import { readFile, writeFile, copyFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './prepare-vocabulary.mjs';
import { readVocabularyFile } from '../js/vocabulary-file.js';
import { previewRows, applyImport } from '../js/vocabulary-schema.js';
const root = fileURLToPath(new URL('..', import.meta.url));
async function main() {
  const args = process.argv.slice(2),
    file = args[0];
  if (!file || file.startsWith('--'))
    throw Error(
      'Usage: npm run import-vocabulary -- "master.xlsx" [--write] [--duplicates=update] [--mode=replace --confirm-replace] [--allow-invalid]',
    );
  const known =
    /^--(?:write|confirm-replace|allow-invalid|duplicates=(?:skip|update)|mode=(?:merge|replace))$/;
  for (const arg of args.slice(1)) if (!known.test(arg)) throw Error(`Unknown option: ${arg}`);
  const mode = args.find((x) => x.startsWith('--mode='))?.split('=')[1] || 'merge',
    duplicates = args.find((x) => x.startsWith('--duplicates='))?.split('=')[1] || 'skip';
  const target = path.join(root, 'data/vocabulary.json'),
    original = await readFile(target, 'utf8'),
    existing = JSON.parse(original),
    buffer = await readFile(path.resolve(file));
  const rows = await readVocabularyFile(file, buffer),
    preview = previewRows(rows, existing);
  console.log(JSON.stringify({ file, ...preview.counts }, null, 2));
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  await writeFile(
    path.join(root, 'test-results/vocabulary-import-report.json'),
    JSON.stringify(preview, null, 2),
    'utf8',
  );
  for (const entry of preview.entries
    .filter((x) => !['new', 'existing'].includes(x.status))
    .slice(0, 30))
    console.log(`${entry.sheet} Row ${entry.row} — ${entry.reason}`);
  console.log('Full preview: test-results/vocabulary-import-report.json');
  if (!args.includes('--write')) {
    console.log(
      'Preview only. Review the report, then repeat with --write to update project data.',
    );
    return;
  }
  if (!preview.counts.rows) throw Error('Empty input; no data changed.');
  if (
    (preview.counts.invalid || preview.counts.incomplete || preview.counts.duplicate) &&
    !args.includes('--allow-invalid')
  )
    throw Error(
      'Fix reported problems first, or explicitly use --allow-invalid to import only valid rows.',
    );
  if (mode === 'replace' && !args.includes('--confirm-replace'))
    throw Error('Replacement requires --confirm-replace after reviewing the preview.');
  const next = applyImport(existing, preview, { mode, duplicates });
  if (!next.length) throw Error('Refusing to write an empty library.');
  const backups = path.join(root, 'docs/vocabulary-backups');
  await mkdir(backups, { recursive: true });
  const backup = path.join(
    backups,
    `vocabulary-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  await copyFile(target, backup);
  const temp = target + '.tmp';
  await writeFile(temp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  await rename(temp, target);
  console.log(`Updated ${existing.length} → ${next.length} records. Backup: ${backup}`);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
