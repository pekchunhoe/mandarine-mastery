import { readVocabularyFile, toCSV, toXLSX } from './vocabulary-file.js';
import { previewRows } from './vocabulary-schema.js';
self.onmessage = async ({ data }) => {
  try {
    const result =
      data.action === 'export'
        ? data.format === 'xlsx'
          ? await toXLSX(data.records)
          : toCSV(data.records)
        : previewRows(await readVocabularyFile(data.name, data.buffer), data.existing);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message || 'Unable to process file / 文件处理失败' });
  }
};
