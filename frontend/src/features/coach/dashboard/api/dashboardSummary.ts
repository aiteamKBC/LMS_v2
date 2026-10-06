import type { CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';
/** Summary wire scalars; null means unavailable, never a fabricated zero. */
export interface DashboardSummary {
  totalLearners: number;
  otjh: { atRisk: number; needAttention: number };
  /** Total pending submissions, never the number of learner groups. */
  pendingMarking: number | null;
  meetingsThisWeek: { pr: number | null; mcm: number | null; catchUps: number };
}

/** Compatibility is local to the existing Dashboard and its session cache. */
export function adaptDashboardSummary(summary: DashboardSummary) {
  const { totalLearners, otjh, pendingMarking, meetingsThisWeek, ...details } = summary;
  return {
    ...details,
    totals: {
      totalLearners, otjhAtRisk: otjh.atRisk, needAttention: otjh.needAttention, pendingMarking,
      prThisWeek: meetingsThisWeek.pr, mcmThisWeek: meetingsThisWeek.mcm,
      catchUpsThisWeek: meetingsThisWeek.catchUps,
    },
    weeklyCounts: {
      progressReviews: meetingsThisWeek.pr ?? 0, monthlyCoaching: meetingsThisWeek.mcm ?? 0,
      catchUps: meetingsThisWeek.catchUps,
      reviewsAvailable: meetingsThisWeek.pr !== null && meetingsThisWeek.mcm !== null,
    },
  };
}


export interface DashboardPopupLearner {
  id: string;
  name: string;
  initials?: string;
  learnerType?: 'commercial' | 'apprenticeship';
  enrolmentId?: string | null;
  programmeStatus?: string | null;
  programme: string | null;
  group: string | null;
  otjh: {
    completed: number | null;
    target: number | null;
    planned: number | null;
    ragStatus: 'at-risk' | 'need-attention' | 'on-track' | 'unavailable';
  };
}

export interface PendingMarkingRow {
  learnerId: string;
  learnerName: string;
  programme: string | null;
  group: string | null;
  pendingCount: number;
  oldestPendingDate: string | null;
  initials?: string;
  totalEvidence?: number;
  isOverdue?: boolean;
}

export interface DashboardPopupContract {
  owner: { name?: string };
  summary: DashboardSummary;
  learnerPopup: { all: DashboardPopupLearner[]; atRisk?: string[] };
  markingPopup: { count: number | null; items: PendingMarkingRow[] };
  meetingsPopup: Record<'pr' | 'mcm' | 'catchUps', { count: number | null; items: Array<{
    id?: string; eventKey?: string; calendarEventId?: string; enrolmentId?: string | null;
    learnerId: string; learnerName: string; programme: string | null; group: string | null;
    date: string; time: string | null; durationMinutes: number; status: CoachCalendarEvent['status'];
  }> }>;
}

/** Stable ID owns a popup row; names and legacy status fields are display-only. */
export function uniquePopupLearners(learners: DashboardPopupLearner[]) {
  const rows = new Map<string, DashboardPopupLearner>();
  for (const learner of learners) {
    if (learner.id != null && !rows.has(String(learner.id))) rows.set(String(learner.id), learner);
  }
  return [...rows.values()];
}

export function selectAtRiskPopupLearners(learners: DashboardPopupLearner[]) {
  return uniquePopupLearners(learners).filter(learner => learner.otjh.ragStatus === 'at-risk');
}

/** Restore only the data shape used by existing cards and popup components. */
export function adaptDashboardPopupContract(wire: DashboardPopupContract) {
  const popupLearners = uniquePopupLearners(wire.learnerPopup.all);
  const atRiskLearners = selectAtRiskPopupLearners(popupLearners);
  return {
    ...adaptDashboardSummary({ ...wire.summary, otjh: { ...wire.summary.otjh, atRisk: atRiskLearners.length } }), owner: wire.owner,
    popupLearners,
    learners: popupLearners.map(row => ({
      id: row.id, name: row.name,
      ...(row.initials !== undefined ? { initials: row.initials } : {}),
      ...(row.learnerType !== undefined ? { learnerType: row.learnerType } : {}),
      ...(row.enrolmentId !== undefined ? { enrolmentId: row.enrolmentId } : {}),
      ...(row.programmeStatus !== undefined ? { rawProgramStatus: row.programmeStatus } : {}),
      programme: row.programme, programmeName: row.programme, group: row.group,
      otjhCompleted: row.otjh.completed, otjhTargetAsOfToday: row.otjh.target, otjhPlanned: row.otjh.planned,
      otjhRagStatus: row.otjh.ragStatus,
    })),
    marking: { summary: { pendingItems: wire.markingPopup.count }, items: wire.markingPopup.items.map(row => 'pendingCount' in row ? ({
      id: row.learnerId, learnerId: row.learnerId, learner: row.learnerName,
      programme: row.programme, group: row.group, pendingEvidence: row.pendingCount,
      submittedAt: row.oldestPendingDate,
      initials: row.initials, totalEvidence: row.totalEvidence, isOverdue: row.isOverdue,
    }) : row) },
    popupWeekEvents: (['pr', 'mcm', 'catchUps'] as const).flatMap(key => wire.meetingsPopup[key].items.map((item, index): CoachCalendarEvent => ({
      id: item.id || item.eventKey || item.calendarEventId || `${key}:${item.learnerId}:${item.date}:${index}`,
      eventKey: item.eventKey, calendarEventId: item.calendarEventId, enrolmentId: item.enrolmentId, learnerId: item.learnerId,
      learner: item.learnerName, title: item.learnerName, programme: item.programme || undefined, group: item.group || undefined,
      source: key === 'pr' ? 'progress-review' : key === 'mcm' ? 'mcr' : 'catch-up',
      type: key === 'pr' ? 'review' : key === 'mcm' ? 'coaching' : 'catch-up',
      date: item.date, scheduledDate: item.date,
      scheduledTime: item.time && /^\d{2}:\d{2}(?::\d{2})?$/.test(item.time) ? item.time : null,
      timeLabel: item.time || 'Time TBC', durationMinutes: item.durationMinutes, status: item.status,
    }))),
  };
}
