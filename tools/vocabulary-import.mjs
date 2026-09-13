import { readFile, writeFile, copyFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readVocabularyFile } from '../js/vocabulary-file.js';
import { previewRows, applyImport } from '../js/vocabulary-schema.js';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const runtimeDataset = path.join(root, 'data/vocabulary.json');
export const importReport = path.join(root, 'test-results/vocabulary-import-report.json');
export const MAX_REMOVED_RECORDS = 25;
export const MAX_REMOVAL_RATE = 0.1;

export function analyzeVocabularyChange(existing, next) {
  const currentById = new Map(existing.map((record) => [record.id, record]));
  const importedById = new Map(next.map((record) => [record.id, record]));
  const added = next.filter((record) => !currentById.has(record.id));
  const removed = existing.filter((record) => !importedById.has(record.id));
  const updated = next.filter(
    (record) =>
      currentById.has(record.id) &&
      JSON.stringify(record) !== JSON.stringify(currentById.get(record.id)),
  );
  const unchanged = next.length - added.length - updated.length;
  const removalRate = existing.length ? removed.length / existing.length : 0;
  return {
    current: existing.length,
    imported: next.length,
    added,
    updated,
    unchanged,
    removed,
    removalRate,
    blocked:
      removed.length > MAX_REMOVED_RECORDS || removalRate > MAX_REMOVAL_RATE,
  };
}

function printChange(change) {
  console.log(
    [
      `Current vocabulary: ${change.current}`,
      `Excel vocabulary: ${change.imported}`,
      `New: ${change.added.length}`,
      `Updated: ${change.updated.length}`,
      `Unchanged: ${change.unchanged}`,
      `Removed: ${change.removed.length}`,
      `Decrease: ${(change.removalRate * 100).toFixed(1)}%`,
    ].join('\n'),
  );
  if (!change.removed.length) return;
  console.warn(`WARNING: ${change.removed.length} existing records will be removed.`);
  const shown = change.removed.slice(0, 20);
  console.warn(`Records scheduled for removal (showing ${shown.length} of ${change.removed.length}):`);
  for (const record of shown) console.warn(`${record.id}  ${record.word}`);
}

export function enforceRemovalGuard(change, { allowRemovals = false } = {}) {
  if (!change.blocked || allowRemovals) return;
  throw Error(
    `Vocabulary update aborted because this import would remove ${change.removed.length} records (${(
      change.removalRate * 100
    ).toFixed(1)}%). No production data was changed. If this deletion is intentional, run: npm run vocabulary:update -- --allow-removals`,
  );
}

function printProblems(preview) {
  for (const entry of preview.entries
    .filter((x) => !['new', 'existing'].includes(x.status))
    .slice(0, 30))
    console.log(`${entry.sheet} Row ${entry.row} — ${entry.reason}`);
}

export async function importVocabulary({
  file,
  write = false,
  mode = 'merge',
  duplicates = 'skip',
  allowInvalid = false,
  allowRemovals = false,
  confirmReplace = false,
  target = runtimeDataset,
  report = importReport,
  backupDirectory,
} = {}) {
  if (!file) throw Error('A vocabulary input file is required.');
  if (!['merge', 'replace'].includes(mode) || !['skip', 'update'].includes(duplicates))
    throw Error('Invalid import option.');

  const original = await readFile(target, 'utf8');
  const existing = JSON.parse(original);
  const buffer = await readFile(path.resolve(file));
  const rows = await readVocabularyFile(file, buffer);
  const preview = previewRows(rows, existing);

  console.log(JSON.stringify({ file, ...preview.counts }, null, 2));
  await mkdir(path.dirname(report), { recursive: true });
  await writeFile(report, JSON.stringify(preview, null, 2), 'utf8');
  printProblems(preview);
  console.log(`Full preview: ${path.relative(root, report)}`);

  if (!write) {
    console.log('Preview only. Review the report, then repeat with --write to update project data.');
    return { preview, records: existing, changed: false };
  }
  if (!preview.counts.rows) throw Error('Empty input; no data changed.');
  if (
    (preview.counts.invalid || preview.counts.incomplete || preview.counts.duplicate) &&
    !allowInvalid
  )
    throw Error(
      'Fix reported problems first, or explicitly use --allow-invalid to import only valid rows.',
    );
  if (mode === 'replace' && !confirmReplace)
    throw Error('Replacement requires --confirm-replace after reviewing the preview.');

  const next = applyImport(existing, preview, { mode, duplicates });
  if (!next.length) throw Error('Refusing to write an empty library.');
  const change = analyzeVocabularyChange(existing, next);
  printChange(change);
  enforceRemovalGuard(change, { allowRemovals });

  const backups = backupDirectory || path.join(root, 'docs/vocabulary-backups');
  await mkdir(backups, { recursive: true });
  const backup = path.join(
    backups,
    `vocabulary-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  await copyFile(target, backup);
  const temp = path.join(path.dirname(target), 'vocabulary.generated.json');
  await writeFile(temp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  await rename(temp, target);
  console.log(
    `Updated ${existing.length} → ${next.length} records. Backup: ${path.relative(root, backup)}`,
  );
  return { preview, records: next, changed: true, backup, change };
}
