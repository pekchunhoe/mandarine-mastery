import './prepare-vocabulary.mjs';
import path from 'node:path';
import { importVocabulary, root } from './vocabulary-import.mjs';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--allow-removals'))
  throw Error('Usage: npm run vocabulary:update [-- --allow-removals]');

const master = path.join(root, 'data/master-vocabulary.xlsx');
const result = await importVocabulary({
  file: master,
  write: true,
  mode: 'replace',
  duplicates: 'update',
  confirmReplace: true,
  allowRemovals: args.includes('--allow-removals'),
});
console.log(
  `Master update complete: ${result.records.length} records generated from data/master-vocabulary.xlsx.`,
);
