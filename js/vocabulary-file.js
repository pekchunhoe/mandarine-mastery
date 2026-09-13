import { fields, columnName, gradeNumber } from './vocabulary-schema.js';
// Lazy loaded only by the teacher importer/exporter; normal lessons consume JSON.
async function spreadsheet() {
  return import('../vendor/xlsx.mjs');
}
export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [],
    cell = '',
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === '"') {
      if (cell || closed) throw Error('Malformed CSV quote / CSV 引号格式错误');
      quoted = true;
    } else if (c === ',' || c === '\r' || c === '\n') {
      row.push(cell);
      cell = '';
      closed = false;
      if (c !== ',') {
        rows.push(row);
        row = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
      }
    } else {
      if (closed) throw Error('Unexpected text after CSV quote / CSV 引号后有多余文字');
      cell += c;
    }
  }
  if (quoted) throw Error('Unclosed CSV quote / CSV 引号未闭合');
  if (cell || row.length || closed) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
export function tableRows(table, sheet = '') {
  const start = table.findIndex((row) => row.some((v) => String(v ?? '').trim()));
  if (start < 0) return [];
  const headers = table[start].map((v) => String(v ?? '').trim()),
    mapped = headers.map(columnName);
  if (!mapped.includes('word') || !mapped.includes('grade'))
    throw Error(`${sheet}: Missing word / grade columns (词语、年级)`);
  const recognized = mapped.filter(Boolean);
  if (new Set(recognized).size !== recognized.length)
    throw Error(`${sheet}: Duplicate column / 重复栏名`);
  return table.slice(start + 1).map((row, i) => {
    if (row.length > headers.length && row.slice(headers.length).some((v) => v != null && v !== ''))
      throw Error(`${sheet} Row ${start + i + 2}: Extra cells / 栏数不一致`);
    const raw = Object.fromEntries(headers.map((h, j) => [h, row[j] ?? '']));
    if (raw._csvEscapedFields) {
      const escaped = JSON.parse(raw._csvEscapedFields);
      if (!Array.isArray(escaped)) throw Error('Invalid CSV escape metadata');
      for (const f of escaped)
        if (fields.includes(f) && typeof raw[f] === 'string' && /^'[=+\-@\t\r]/.test(raw[f]))
          raw[f] = raw[f].slice(1);
      delete raw._csvEscapedFields;
    }
    return { sheet, row: start + i + 2, raw };
  });
}
export async function readVocabularyFile(name, buffer) {
  if (buffer.byteLength > 25 * 1024 * 1024)
    throw Error('File exceeds 25 MB / 文件超过 25 MB，请分批导入');
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'json' || ext === 'csv') {
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
    } catch {
      throw Error('Please save as UTF-8 / 请另存为 CSV UTF-8');
    }
    if (ext === 'csv') return tableRows(parseCSV(text), name);
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw Error('JSON must be an array / JSON 须为记录数组');
    return data.map((raw, i) => ({ raw, row: i + 1, sheet: name }));
  }
  if (!['xlsx', 'xls'].includes(ext)) throw Error('Use .xlsx, .xls, .csv or .json / 不支持此格式');
  const XLSX = await spreadsheet(),
    bytes = new Uint8Array(buffer);
  if (
    (ext === 'xlsx' && !(bytes[0] === 80 && bytes[1] === 75)) ||
    (ext === 'xls' && !(bytes[0] === 208 && bytes[1] === 207))
  )
    throw Error('Unsupported or malformed workbook / 工作簿格式错误');
  const book = XLSX.read(buffer, { type: 'array', cellFormula: true, sheetRows: 50002 });
  const result = [];
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (sheet['!ref'] && XLSX.utils.decode_range(sheet['!ref']).e.r >= 50000)
      throw Error('Maximum 50,000 rows per sheet / 请把工作表分批导入');
    for (const [address, cell] of Object.entries(sheet))
      if (!address.startsWith('!') && cell.f)
        throw Error(`${name} ${address}: Replace formulas with values / 请将公式粘贴为值`);
    const table = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: true,
    });
    if (!table.some((row) => row.some(Boolean))) continue;
    // Read the original project's three-words-per-character workbook too.
    const legacy = table.findIndex((row) => row.includes('生字') && row.includes('词语1'));
    if (legacy >= 0) {
      const headers = table[legacy],
        grade = gradeNumber(name);
      if (!grade) throw Error(`${name}: Invalid legacy sheet grade`);
      let lesson = null;
      for (let i = legacy + 1; i < table.length; i++) {
        const r = table[i],
          get = (h) => r[headers.indexOf(h)] || '',
          character = get('生字');
        lesson = get('课次') || lesson;
        if (!character) continue;
        for (let n = 1; n <= 3; n++) {
          const word = get(`词语${n}`);
          result.push({
            sheet: name,
            row: i + 1,
            raw: {
              id: `${grade}-${character}-${word}`,
              word,
              grade,
              character,
              lesson,
              exampleSentence: get(`参考造句${n}`),
            },
          });
        }
      }
    } else result.push(...tableRows(table, name));
  }
  return result;
}
const cellText = (v) => (Array.isArray(v) ? JSON.stringify(v) : (v ?? ''));
export function toCSV(records) {
  const quote = (v) => '"' + String(cellText(v)).replaceAll('"', '""') + '"';
  // Neutralize spreadsheet formulas; our importer reverses only this explicit escape.
  return (
    '\uFEFF' +
    [
      [...fields, '_csvEscapedFields'],
      ...records.map((w) => {
        const escaped = [];
        const row = fields.map((f) => {
          const s = String(cellText(w[f]));
          if (/^[=+\-@\t\r]/.test(s)) {
            escaped.push(f);
            return "'" + s;
          }
          return s;
        });
        return [...row, JSON.stringify(escaped)];
      }),
    ]
      .map((row) => row.map(quote).join(','))
      .join('\r\n')
  );
}
export async function toXLSX(records) {
  const XLSX = await spreadsheet(),
    book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    fields,
    ...records.map((w) => fields.map((f) => cellText(w[f]))),
  ]);
  sheet['!cols'] = fields.map((f) => ({ wch: f === 'exampleSentence' ? 65 : 22 }));
  XLSX.utils.book_append_sheet(book, sheet, 'Vocabulary');
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' });
}
