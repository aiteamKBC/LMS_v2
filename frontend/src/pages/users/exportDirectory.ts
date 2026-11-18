import { utils, write } from 'xlsx';
import type { SavedAttendanceMode } from '@/api/attendanceLectures';
import { isLearnerRow } from './page.helpers';
import type { UserListRow } from './types';

export type DirectoryAttendanceModes = Record<string, SavedAttendanceMode> | 'failed' | null;

/** Export only the directory's displayed fields, never the full API records. */
export function createDirectoryWorkbook(rows: UserListRow[], modes: DirectoryAttendanceModes): ArrayBuffer {
  const values = rows.map(row => {
    const learner = isLearnerRow(row);
    return [
      row.name, row.type, row.email, row.group,
      learner ? row.programme ?? '' : '',
      learner ? row.cohort ?? '' : '',
      learner ? row.caseOwner ?? '' : '',
      row.subscriptionStatus,
      learner ? ((row.hasLearningPlan ?? row.learningPlan) ? 'Yes' : 'No') : '',
      learner ? row.programmeStatus ?? '' : '',
      !learner ? '' : !modes || modes === 'failed' ? 'Unavailable'
        : modes[row.id]?.mode === 'lazy' ? 'Recorded' : 'Live Sessions',
    ];
  });
  // String cells preserve leading zeroes and formula-like text as literal data.
  const sheet = utils.aoa_to_sheet([
    ['User', 'Type', 'Email', 'Group', 'Programme', 'Cohort', 'Case owner',
      'Subscription status', 'Learning plan', 'Programme status', 'Attendance mode'],
    ...values,
  ]);
  sheet['!cols'] = [28, 20, 38, 30, 40, 26, 26, 22, 18, 22, 20].map(wch => ({ wch }));
  sheet['!autofilter'] = { ref: sheet['!ref']! };
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, sheet, 'Enrolment');
  return write(workbook, { bookType: 'xlsx', type: 'array', compression: true });
}
