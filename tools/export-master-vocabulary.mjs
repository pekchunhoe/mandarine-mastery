import './prepare-vocabulary.mjs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { root, runtimeDataset } from './vocabulary-import.mjs';
import { toXLSX } from '../js/vocabulary-file.js';
import { previewRows } from '../js/vocabulary-schema.js';

const output = path.join(root, 'data/master-vocabulary.xlsx');
const records = JSON.parse(await readFile(runtimeDataset, 'utf8'));
const preview = previewRows(records);
if (
  preview.counts.rows !== records.length ||
  preview.counts.invalid ||
  preview.counts.incomplete ||
  preview.counts.duplicate
)
  throw Error('Runtime vocabulary JSON is not safe to export as the master workbook.');

const temp = path.join(path.dirname(output), 'master-vocabulary.generated.xlsx');
await writeFile(temp, new Uint8Array(await toXLSX(records)));
await rename(temp, output);
console.log(`Exported ${records.length} records to ${path.relative(root, output)}.`);
