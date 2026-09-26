import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';

export type MonthlyHours = {
  key: string;
  label: string;
  target: number | null;
  submitted: number | null;
  completed: number | null;
};

function isMonthKey(key: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(key);
}

export function monthFromDate(value: string | null | undefined) {
  const month = value?.slice(0, 7) || '';
  return isMonthKey(month) ? month : '';
}

export function monthRange(keys: string[], programmeStartMonth = '', programmeEndMonth = '') {
  const valid = [...new Set(keys.filter(isMonthKey))].sort();
  const start = isMonthKey(programmeStartMonth) ? programmeStartMonth : valid[0] || '';
  const end = isMonthKey(programmeEndMonth) ? programmeEndMonth : valid.at(-1) || '';
  if (!start || !end || start > end) return [];
  const result: string[] = [];
  const cursor = new Date(`${start}-01T12:00:00Z`);
  while (cursor.toISOString().slice(0, 7) <= end) {
    result.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}

export function monthlyHours(data: TrainingPlanDashboard, programmeStartMonth = '', programmeEndMonth = ''): MonthlyHours[] {
  const keys = monthRange([
    ...Object.keys(data.months),
    ...Object.keys(data.monthlyOtjh || {}),
    ...Object.keys(data.monthlyLogOtjh || {}),
    ...data.actual.map(row => row.month),
  ], programmeStartMonth, programmeEndMonth);
  const recordedAvailable = data.actualAvailable !== false || Object.keys(data.monthlyOtjh || {}).length > 0;
  return keys.map(key => {
    const useAudit = !!data.auditOtjhCutoffMonth && key <= data.auditOtjhCutoffMonth;
    const monthlyLog = data.monthlyLogOtjh?.[key];
    const current = data.monthlyOtjh?.[key];
    const historical = data.actual.filter(row => row.month === key).reduce((sum, row) => sum + row.hours, 0);
    // A Monthly Logs row can legitimately have no stored target (for example,
    // when the log was created before the contract target was imported).  The
    // target is a plan value, so use the contract/current-plan value as a
    // fallback while keeping the log as the authoritative source when it has
    // one.  This lets cumulative target-to-date calculations remain usable
    // without changing the completed-hours provenance rules below.
    const planned = data.months[key]?.planned ?? current?.planned ?? null;
    // Marking contributes to submitted. Retained Audit and accepted LMS hours
    // contribute to completed, exactly once, through Monthly Logs when present.
    const submitted = monthlyLog ? monthlyLog.submitted : useAudit ? null : recordedAvailable ? (current?.submitted ?? 0) : null;
    const completed = monthlyLog ? monthlyLog.completed : useAudit ? null : recordedAvailable ? historical + (current?.actual ?? 0) : null;
    return {
      key,
      label: new Date(`${key}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      target: monthlyLog?.target ?? planned,
      submitted,
      completed,
    };
  });
}

export function totalCompletedHours(data: TrainingPlanDashboard, programmeStartMonth = '', programmeEndMonth = '') {
  const rows = monthlyHours(data, programmeStartMonth, programmeEndMonth);
  return rows.length && rows.every(row => row.completed != null)
    ? rows.reduce((sum, row) => sum + row.completed!, 0)
    : null;
}

export function hasMonthlyHourData(data: TrainingPlanDashboard) {
  return Object.keys(data.months).length > 0
    || Object.keys(data.monthlyOtjh || {}).length > 0
    || Object.keys(data.monthlyLogOtjh || {}).length > 0
    || data.actual.length > 0;
}
