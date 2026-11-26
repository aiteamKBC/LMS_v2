import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseEventInviteSpreadsheet } from '../eventInviteSpreadsheet';

function spreadsheetFile(rows: unknown[][], name = 'invitees.xlsx') {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Invitees');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: name.endsWith('.csv') ? 'csv' : 'xlsx' });
  return new File([bytes], name, { type: name.endsWith('.csv') ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

describe('parseEventInviteSpreadsheet', () => {
  it('reads Excel invitees and deduplicates email addresses case-insensitively', async () => {
    const recipients = await parseEventInviteSpreadsheet(spreadsheetFile([
      ['Full Name', 'Email Address'],
      ['Alex Morgan', 'alex@example.com'],
      ['Alex Duplicate', 'ALEX@example.com'],
    ]));

    expect(recipients).toEqual([{ name: 'Alex Morgan', email: 'alex@example.com' }]);
  });

  it('reads CSV exports and reports invalid rows before returning recipients', async () => {
    const file = spreadsheetFile([['Name', 'Email'], ['Sam Lee', 'sam@example.com']], 'invitees.csv');
    await expect(parseEventInviteSpreadsheet(file)).resolves.toEqual([{ name: 'Sam Lee', email: 'sam@example.com' }]);

    const invalid = spreadsheetFile([['Name', 'Email'], ['Sam Lee', 'not-an-email']]);
    await expect(parseEventInviteSpreadsheet(invalid)).rejects.toThrow('Row 2: email is invalid.');
  });

  it('rejects unrecognized extensions and missing required columns', async () => {
    const wrongExtension = spreadsheetFile([['Name', 'Email'], ['Sam Lee', 'sam@example.com']], 'invitees.xls');
    await expect(parseEventInviteSpreadsheet(wrongExtension)).rejects.toThrow('Upload an Excel .xlsx or CSV file');

    const missingName = spreadsheetFile([['Email'], ['sam@example.com']]);
    await expect(parseEventInviteSpreadsheet(missingName)).rejects.toThrow('exactly one name column');
  });
});
