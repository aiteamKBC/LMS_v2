import * as XLSX from 'xlsx';

export interface EventInvitee {
  name: string;
  email: string;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;
const EMAIL_HEADERS = new Set(['email', 'email address', 'attendee email']);
const NAME_HEADERS = new Set(['name', 'full name', 'attendee name', 'student name', 'learner name']);

function normaliseHeader(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replaceAll('_', ' ').replace(/\s+/g, ' ');
}

function columnIndex(headers: unknown[], aliases: Set<string>, label: string) {
  const positions = headers.flatMap((value, index) => aliases.has(normaliseHeader(value)) ? [index] : []);
  if (positions.length !== 1) throw new Error(`The spreadsheet needs exactly one ${label} column.`);
  return positions[0];
}

export async function parseEventInviteSpreadsheet(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension !== 'xlsx' && extension !== 'csv') throw new Error('Upload an Excel .xlsx or CSV file exported from Excel or Google Sheets.');
  if (file.size < 1 || file.size > MAX_FILE_BYTES) throw new Error('The spreadsheet must be between 1 byte and 5 MB.');

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  } catch {
    throw new Error('The spreadsheet could not be read.');
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName && workbook.Sheets[sheetName];
  if (!sheet) throw new Error('The spreadsheet is empty.');

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' });
  if (!rows.length) throw new Error('The spreadsheet is empty.');
  if (rows.length - 1 > MAX_ROWS) throw new Error(`The spreadsheet can contain at most ${MAX_ROWS} data rows.`);
  const headers = rows[0];
  const nameColumn = columnIndex(headers, NAME_HEADERS, 'name');
  const emailColumn = columnIndex(headers, EMAIL_HEADERS, 'email');
  const recipients = new Map<string, EventInvitee>();
  const errors: string[] = [];

  rows.slice(1).forEach((row, index) => {
    const name = String(row[nameColumn] ?? '').trim();
    const email = String(row[emailColumn] ?? '').trim().toLowerCase();
    if (!name && !email) return;
    const rowNumber = index + 2;
    if (!name) errors.push(`Row ${rowNumber}: name is missing.`);
    else if (name.length > 255) errors.push(`Row ${rowNumber}: name exceeds 255 characters.`);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(`Row ${rowNumber}: email is invalid.`);
    if (name && email && recipients.has(email)) return;
    if (name && email && name.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      recipients.set(email, { name, email });
    }
  });
  if (errors.length) throw new Error(errors.slice(0, 10).join(' ') + (errors.length > 10 ? ` ${errors.length - 10} more row error(s).` : ''));
  if (!recipients.size) throw new Error('The spreadsheet has no invitees.');
  return [...recipients.values()];
}
