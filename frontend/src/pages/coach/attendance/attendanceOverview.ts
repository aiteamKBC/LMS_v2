export interface AttendanceIdentity {
  id: string;
  learner: string;
  email?: string | null;
}

export interface AbsenceReportIdentity {
  learnerId?: string | null;
  learner: string;
  email?: string | null;
  sessionDate?: string | null;
}

function normalizeIdentity(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function isWithinDateRange(value?: string | null, from?: string, to?: string) {
  if (!from && !to) return true;
  const date = String(value || '').slice(0, 10);
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

export function countLearnerAbsenceReports(
  reports: AbsenceReportIdentity[],
  learner: AttendanceIdentity,
  from = '',
  to = '',
) {
  const learnerId = normalizeIdentity(learner.id);
  const learnerEmail = normalizeIdentity(learner.email);
  const learnerName = normalizeIdentity(learner.learner);

  return reports.filter((report) => {
    if (!isWithinDateRange(report.sessionDate, from, to)) return false;

    const reportId = normalizeIdentity(report.learnerId);
    if (reportId && learnerId) return reportId === learnerId;

    const reportEmail = normalizeIdentity(report.email);
    if (reportEmail && learnerEmail) return reportEmail === learnerEmail;

    return normalizeIdentity(report.learner) === learnerName;
  }).length;
}

export function absenceReportHealth(submitted: number, absent?: number | null) {
  if (absent === null || absent === undefined) return 'unknown' as const;
  if (absent === 0 || submitted >= absent) return 'complete' as const;
  if (submitted > 0) return 'partial' as const;
  return 'missing' as const;
}
