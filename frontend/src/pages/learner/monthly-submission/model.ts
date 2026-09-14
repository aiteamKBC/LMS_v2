import type { LearnerDetail } from '@/api/learnerDetail';
import type { TrainingPlanContract } from '@/api/trainingPlanDashboard';
import type { CoverMetadata } from '../my-learning/SubjectWorkspace';
import { completedComponentIds, componentRequiresEvidence, hasComponentContent } from '@/utils/learnerJourney';
import { dateKey } from '../training-plan-timeline/model';

export const statusLabels: Record<string, string> = {
  todo: 'To do', draft: 'Draft saved', submitted_for_tutor_review: 'Awaiting coach review', escalated: 'Awaiting coach review',
  accepted: 'Accepted', completed: 'Completed', referred: 'Changes requested',
  returned: 'Changes requested', rejected: 'Changes requested', partial: 'Partially accepted',
};

export function monthName(month: string) {
  return month ? new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'Europe/London',
  }) : 'Not scheduled';
}

export function groupMonthlyAssignments(real: LearnerDetail, metadata: CoverMetadata | null,
  contract: TrainingPlanContract | null, statuses: Record<string, string> | null) {
  const completed = completedComponentIds(real);
  const seen = new Set<string>();
  const assignments = real.components.filter(component => {
    if (!component.componentId || !componentRequiresEvidence(component.type) || seen.has(component.componentId)) return false;
    seen.add(component.componentId);
    return true;
  }).map(component => {
    const id = component.componentId!;
    const schedule = metadata?.activity_dates?.[id];
    // Import timestamps are not delivery dates; ambiguous dates stay unscheduled.
    const useSchedule = schedule && !['original_created_at', 'source_date', 'undated'].includes(schedule.date_source || '');
    const date = useSchedule ? schedule.date_needs_review ? '' : dateKey(schedule.date) : dateKey(component.sessionDate);
    const month = date.slice(0, 7);
    const status = statuses?.[id] || real.componentMarkingStatus?.[id]?.status
      || (completed.has(id) ? 'completed' : statuses ? 'todo' : '');
    const submitted = ['submitted_for_tutor_review', 'escalated', 'accepted', 'completed'].includes(status);
    const revise = ['referred', 'returned', 'rejected', 'partial'].includes(status);
    const hasContent = hasComponentContent({ ...component, title: component.component });
    const awaitingBrief = !hasContent && status === 'todo';
    return { ...component, id, date, month, status, submitted, awaitingBrief,
      marking: real.componentMarkingStatus?.[id],
      action: awaitingBrief ? 'Awaiting assignment brief' : status === 'draft' ? 'Continue assignment'
        : revise ? 'Read feedback & update' : ['accepted', 'completed'].includes(status) ? 'View result'
          : submitted ? 'View submission' : status === 'todo' ? 'Start assignment' : 'Open assignment' };
  });
  const groups = new Map<string, typeof assignments>();
  for (const assignment of assignments) {
    const rows = groups.get(assignment.month) || [];
    rows.push(assignment);
    groups.set(assignment.month, rows);
  }
  return [...groups].sort(([a], [b]) => a && b ? a.localeCompare(b) : a ? -1 : b ? 1 : 0).map(([month, rows]) => ({
    month, label: contract?.months[month]?.label?.trim() || monthName(month),
    topics: contract?.months[month]?.topics || [],
    assignments: rows.sort((a, b) => a.date.localeCompare(b.date)),
    submitted: rows.filter(row => row.submitted).length,
  }));
}

export type AssignmentMonth = ReturnType<typeof groupMonthlyAssignments>[number];
export type MonthlyAssignmentRow = AssignmentMonth['assignments'][number];

export function currentAssignmentMonthKey(today = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' }).formatToParts(today);
  return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}`;
}

/** Fresh visits describe the current month even when it has no work. */
export function defaultAssignmentMonth(groups: AssignmentMonth[], today = new Date()) {
  return groups.find(group => group.month === currentAssignmentMonthKey(today));
}

export function needsAssignmentChanges(row: MonthlyAssignmentRow) {
  return ['referred', 'returned', 'rejected', 'partial'].includes(row.status);
}

export function assignmentCounts(rows: MonthlyAssignmentRow[]) {
  const counts = { needsWork: 0, awaitingReview: 0, completed: 0, waitingForBrief: 0, unknown: 0, total: rows.length };
  for (const row of rows) {
    if (row.awaitingBrief) counts.waitingForBrief++;
    else if (['submitted_for_tutor_review', 'escalated'].includes(row.status)) counts.awaitingReview++;
    else if (['accepted', 'completed'].includes(row.status)) counts.completed++;
    else if (needsAssignmentChanges(row) || ['draft', 'todo'].includes(row.status)) counts.needsWork++;
    else counts.unknown++;
  }
  return counts;
}

/** Prioritise work the learner can act on; planned dates are not deadlines. */
export function nextMonthlyAssignment(rows: MonthlyAssignmentRow[]) {
  const priority = (row: MonthlyAssignmentRow) => needsAssignmentChanges(row) ? 0 : row.status === 'draft' ? 1 : row.status === 'todo' ? 2 : 3;
  return rows.filter(row => !row.awaitingBrief && priority(row) < 3)
    .sort((a, b) => priority(a) - priority(b) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id))[0];
}

export function monthlyAssignmentHref(row: MonthlyAssignmentRow, kind: string, learnerId: string) {
  return `/learner/monthly-submission/${kind}/${encodeURIComponent(learnerId)}/${encodeURIComponent(row.id)}`
    + (row.month ? `?month=${row.month}` : '');
}
