import { downloadCsv } from '@/utils/bulkCsv';
import type { UserListRow } from './types';

export const USERS_CSV_HEADERS = [
  'User ID', 'Name', 'Type', 'Email', 'Group', 'Programme', 'Cohort',
  'Subscription Status', 'Programme Status', 'Attendance Mode',
];

/** Keep spreadsheet formulas inert, including whitespace/control prefixes. */
function spreadsheetText(value: string | undefined): string {
  const text = value ?? '';
  let offset = 0;
  while (offset < text.length && (/\s/u.test(text[offset])
    || text.charCodeAt(offset) <= 31 || text.charCodeAt(offset) === 127)) offset++;
  const formula = offset < text.length && '=+-@＝＋－＠'.includes(text[offset]);
  const controlPrefix = text.startsWith('\t') || text.startsWith('\r') || text.startsWith('\n');
  return formula || controlPrefix ? `'${text}` : text;
}

export function usersCsvRows(
  users: readonly UserListRow[], attendanceLabel: (user: UserListRow) => string,
): string[][] {
  return [USERS_CSV_HEADERS, ...users
    // Defensive source check: never turn independent staff/employer records
    // into directory exports, even if a caller passes a mixed list.
    .filter(user => user.source !== 'staff' && user.source !== 'employer')
    .map(user => [
      user.id, user.name, user.type, user.email, user.group, user.programme || '—', user.cohort || '—',
      user.subscriptionStatus, user.programmeStatus, attendanceLabel(user),
    ].map(spreadsheetText))];
}

export function exportUsersCsv(
  users: readonly UserListRow[], attendanceLabel: (user: UserListRow) => string, now = new Date(),
): void {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  downloadCsv(`users-directory-${timestamp}.csv`, usersCsvRows(users, attendanceLabel));
}
