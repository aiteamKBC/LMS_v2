import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseTemplate } from '@/components/feature/KsbFrameworkManager';

const SHEET = 'KSB Framework Template';

function templateFile(rows: Array<Record<string, string>>) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, SHEET);
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([buffer], 'ksb-template.xlsx');
}

describe('KSB template import', () => {
  it('reads the three-column template and puts each point under its parent', async () => {
    const { items, result } = await parseTemplate(templateFile([
      { Type: 'K', Code: 'K1', Description: 'Marketing Concepts and Theory' },
      { Type: 'S', Code: 'S1', Description: 'Research and Analysis' },
      { Type: 'K', Code: 'K1.1', Description: 'The fundamentals of marketing' },
    ]));

    expect(result.errorRows).toEqual([]);
    expect(result.importedRows).toBe(3);
    expect(result.applied).toBe(false);
    // K then S, and the dotted point directly under the code it belongs to.
    expect(items.map(item => `${item.type}${item.code}`)).toEqual(['K1', 'K1.1', 'S1']);
    // No parent column in the file: K1.1 takes its parent from its own code.
    expect(items[1].parentCode).toBe('1');
    expect(items[0].title).toBe('Marketing Concepts and Theory');
  });

  it('drops only the bad rows so the rest stay importable', async () => {
    const { items, result } = await parseTemplate(templateFile([
      { Type: 'K', Code: 'K1', Description: 'Kept' },
      { Type: 'K', Code: 'K1', Description: 'Duplicate of row 2' },
      { Type: 'K', Code: 'K9.1', Description: 'Child of a parent that is not here' },
      { Type: 'K', Code: 'K2', Description: 'Also kept' },
    ]));

    expect(items.map(item => `${item.type}${item.code}`)).toEqual(['K1', 'K2']);
    expect(items[0].title).toBe('Kept');
    expect(result.importedRows).toBe(2);
    expect(result.errorRows.map(row => [row.row, row.field])).toEqual([[3, 'code'], [4, 'parent_code']]);
  });

  it('reports the spreadsheet row when the description is missing', async () => {
    const { result } = await parseTemplate(templateFile([
      { Type: 'K', Code: 'K1', Description: 'Present' },
      { Type: 'K', Code: 'K2', Description: '' },
    ]));

    expect(result.errorRows).toEqual([{ row: 3, field: 'description', message: 'Description is required.' }]);
    expect(result.importedRows).toBe(1);
  });

  it('still reads the older six-column file', async () => {
    const { items, result } = await parseTemplate(templateFile([
      { type: 'K', code: '1', parent_code: '', title: 'Marketing Concepts', description: 'Core models.', display_order: '1' },
      { type: 'K', code: '1.1', parent_code: '1', title: 'The fundamentals', description: 'Customer value.', display_order: '2' },
    ]));

    expect(result.errorRows).toEqual([]);
    expect(items.map(item => [item.title, item.description])).toEqual([
      ['Marketing Concepts', 'Core models.'],
      ['The fundamentals', 'Customer value.'],
    ]);
    expect(items[1].parentCode).toBe('1');
  });
});
