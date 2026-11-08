import { afterEach, expect, it, vi } from 'vitest';
import { read, utils } from 'xlsx';
import { exportUsersCsv, usersCsvRows, USERS_CSV_HEADERS } from '../directoryExport';
import type { UserListRow } from '../types';

const user = (over: Partial<UserListRow> = {}): UserListRow => ({
  id: '42', uuid: null, name: 'Example User', type: 'User', email: 'shared@example.test',
  source: 'commercial', group: 'Group A', programme: 'Programme A', cohort: 'Cohort A',
  subscriptionStatus: 'Invited', programmeStatus: 'Delivery', subscriptionVerified: false,
  learningPlan: false, ...over,
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('preserves all ten columns, Created_users IDs and distinct shared-email users', () => {
  const rows = usersCsvRows([user(), user({ id: '900' })], () => 'Recorded');
  expect(rows[0]).toEqual(USERS_CSV_HEADERS);
  expect(rows[1]).toEqual(['42', 'Example User', 'User', 'shared@example.test', 'Group A',
    'Programme A', 'Cohort A', 'Invited', 'Delivery', 'Recorded']);
  expect(rows[2][0]).toBe('900');
});

it('does not export independent Staff or Employer sources', () => {
  expect(usersCsvRows([user(), user({ source: 'staff' }), user({ source: 'employer' })], () => '—'))
    .toHaveLength(2);
});

it.each(['=1+1', '+SUM(A1)', '-1+2', '@SUM(A1)', ' \t=1+1', '\r\n=1+1', '\ttext', '\ntext', '＝1+1', '\ufeff@SUM(A1)', '\0=1+1', '\x7f=1+1'])(
  'neutralises spreadsheet formula/control prefix %j', name => {
    expect(usersCsvRows([user({ name })], () => 'Live Sessions')[1][1]).toBe(`'${name}`);
  },
);

it('protects every exported cell, including identifiers and attendance labels', () => {
  const record = user({ id: '=42', name: '=name', type: '+type', email: '@mail', group: '-group',
    programme: '=programme', cohort: '=cohort', subscriptionStatus: '=status', programmeStatus: '=programme-status' });
  expect(usersCsvRows([record], () => '=attendance')[1].every(cell => cell.startsWith("'"))).toBe(true);
});

it('exports a header-only CSV for an empty matching result', () => {
  expect(usersCsvRows([], () => 'Live Sessions')).toEqual([USERS_CSV_HEADERS]);
});

it('downloads UTF-8 BOM CSV that round-trips Arabic, commas, quotes and newlines', async () => {
  const blobs: Blob[] = [];
  const links: { filename: string; href: string }[] = [];
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:users-export'; }),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    links.push({ filename: this.download, href: this.href });
    expect(document.body.contains(this)).toBe(true);
  });
  const name = 'متعلم, "مثال"\nسطر آخر';
  exportUsersCsv([user({ name, group: undefined, programme: undefined, cohort: '' })], () => '—', new Date('2026-11-01T12:30:00.000Z'));
  expect(links).toEqual([{ filename: 'users-directory-2026-11-01T12-30-00-000Z.csv', href: 'blob:users-export' }]);
  expect(blobs[0].type).toBe('text/csv;charset=utf-8;');
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blobs[0]);
  });
  expect([...new Uint8Array(bytes).slice(0, 3)]).toEqual([239, 187, 191]);
  const workbook = read(new Uint8Array(bytes), { type: 'array', raw: true });
  const data = utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' });
  expect(data[0]).toEqual(USERS_CSV_HEADERS);
  expect(data[1][1]).toBe(name);
  expect(data[1][4]).toBe('');
  expect(data[1].slice(5, 7)).toEqual(['—', '—']);
  expect(data[1][9]).toBe('—');
  expect(document.querySelector('a[download]')).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:users-export');
});
