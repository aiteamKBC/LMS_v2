// ============================================================================
// CSV / PDF export for the filtered queue. Unchanged from the pre-refactor
// page — presentation only touched the buttons that call these.
// ============================================================================
import { type CatchUpItem } from '@/mocks/catchup-queue';

export function exportCatchUpCsv(rows: CatchUpItem[]): void {
  const headers = ['Learner', 'Programme', 'Cohort', 'Missed Session', 'Missed Date', 'Catch-up Date', 'Tutor', 'Status', 'Priority', 'Notes', 'Reason', 'Overdue Days'];
  const csvRows = rows.map((c) => [
    c.learner, c.programme, c.cohort, c.missedSession, c.missedDate, c.catchupDate, c.tutor, c.status, c.priority, c.notes, c.reason, String(c.daysOverdue),
  ]);
  const csv = [headers.join(','), ...csvRows.map((r) => r.map((cell) => `"${cell}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'catch-up-queue.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

export function exportCatchUpPdf(rows: CatchUpItem[]): void {
  const lines = rows.map((c) => `${c.learner} | ${c.programme} | ${c.missedSession} | ${c.missedDate} | ${c.catchupDate} | ${c.status} | ${c.priority}`).join('\n');
  const text = `Catch-up Queue Report\nGenerated: ${new Date().toLocaleDateString()}\n\n${lines}`;
  const blob = new Blob([text], { type: 'text/plain' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'catch-up-queue-report.txt';
  link.click();
  URL.revokeObjectURL(link.href);
}
