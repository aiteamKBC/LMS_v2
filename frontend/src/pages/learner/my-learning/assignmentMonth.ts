export function assignmentMonth(row: { month: string | null; dateCompleted: string | null; submittedAt: string | null }): string {
  for (const date of [row.month, row.dateCompleted, row.submittedAt]) {
    const match = /^(\d{4}-(?:0[1-9]|1[0-2]))(?:$|-|T)/.exec(date || '');
    if (match) return match[1];
  }
  return '';
}
