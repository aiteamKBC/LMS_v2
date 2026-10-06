import { parseDisplayDate } from '@/pages/coach/caseload/lib/format';
import type { CaseloadApiLearner } from '@/pages/coach/caseload/types';

/** Wire contract for the dashboard All Learners endpoint only. */
export interface DashboardLearnerRow {
  id: string;
  name: string;
  initials: string;
  learnerType?: 'commercial' | 'apprenticeship';
  enrolmentId?: string | null;
  programme: string | null;
  programmeStatus: string | null;
  otjh: { completed: number | null; targetToDate: number | null; progress: number | null;
    ragStatus: 'at-risk' | 'need-attention' | 'on-track' | 'unavailable' };
  activities: { completed: number | null; total: number | null; progress: number | null };
  attendance: { rate: number | null };
  startDate: string | null;
  lastActivity: { date: string | null };
  lastPr: string | null;
  lastMcm: string | null;
}

/** Adapt the wire DTO to the existing table; never derive OTJH values. */
export function adaptDashboardLearnerRow(row: DashboardLearnerRow): CaseloadApiLearner {
  const activityDate = parseDisplayDate(row.lastActivity.date);
  const activityLabel = activityDate
    ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(activityDate)
    : row.lastActivity.date || undefined;
  return {
    id: row.id, name: row.name, initials: row.initials,
    learnerType: row.learnerType, enrolmentId: row.enrolmentId,
    programmeName: row.programme || undefined, rawProgramStatus: row.programmeStatus || undefined,
    enrollmentStatus: 'unknown', status: 'unavailable',
    employer: '--', cohortId: '', cohortName: '--', group: '--', riskFlags: [],
    overallProgress: 0,
    otjhCompleted: row.otjh.completed, otjhTargetAsOfToday: row.otjh.targetToDate,
    otjhProgressAsOfToday: row.otjh.progress, otjhRagStatus: row.otjh.ragStatus,
    componentsCompleted: row.activities.completed, componentsPlanned: row.activities.total,
    activityProgress: row.activities.progress, activityProgressAvailable: row.activities.progress !== null,
    attendanceRate: row.attendance.rate, attendanceAvailable: row.attendance.rate !== null,
    startDate: row.startDate, lastActivity: activityLabel,
    lastActivityDate: row.lastActivity.date, lastPr: row.lastPr, lastMcm: row.lastMcm,
  } as CaseloadApiLearner;
}
