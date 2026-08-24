// ============================================================================
// Catch-up queue data shaping — pure functions, no rendering.
//
// Moved out of page.tsx unchanged: this is the derivation of status, priority
// and overdue days from a raw calendar event, plus the weekly/monthly bucket
// builder for the volume trend chart. Business logic only — do not change the
// thresholds here without checking with whoever owns the catch-up policy.
// ============================================================================
import {
  type CoachCalendarEvent,
  eventDisplayDate,
  formatDateLabel,
  initialsFor,
  parseLocalDate,
  startOfDay,
} from '@/pages/coach/shared/calendarEvents';
import { type CatchUpItem } from '@/mocks/catchup-queue';

export function calendarEventToCatchUp(event: CoachCalendarEvent): CatchUpItem {
  const today = startOfDay();
  const targetDateIso = event.targetDate || event.date || event.scheduledDate || '';
  const catchupDateIso = eventDisplayDate(event) || targetDateIso;
  const catchupDate = parseLocalDate(catchupDateIso);
  const completed = event.status === 'completed' || event.status === 'confirmed';
  const overdue = !completed && !!catchupDate && catchupDate.getTime() < today.getTime();
  const status: CatchUpItem['status'] = completed ? 'completed' : overdue ? 'overdue' : 'scheduled';
  const daysUntil = catchupDate ? Math.ceil((catchupDate.getTime() - today.getTime()) / 86_400_000) : 30;
  const priority: CatchUpItem['priority'] = overdue || event.priority === 'high' || event.priority === 'urgent'
    ? 'high'
    : daysUntil <= 14
      ? 'medium'
      : 'low';
  const daysOverdue = overdue && catchupDate
    ? Math.max(1, Math.floor((today.getTime() - catchupDate.getTime()) / 86_400_000))
    : 0;

  return {
    id: event.eventKey || event.id,
    learner: event.learner || 'Unknown learner',
    initials: initialsFor(event.learner),
    programme: event.programme || '--',
    cohort: event.cohort || '--',
    missedSession: event.title || 'Catch-up Session',
    missedDate: formatDateLabel(targetDateIso),
    missedDateIso: targetDateIso,
    catchupDate: formatDateLabel(catchupDateIso),
    catchupDateIso,
    tutor: event.ownerName || 'Coach',
    status,
    priority,
    notes: event.notes || 'No notes added',
    overallProgress: 0,
    attendance: 0,
    otjhCompleted: 0,
    otjhTarget: 0,
    ksbProgress: 0,
    employer: 'Not available',
    group: 'Not available',
    evidenceSubmitted: completed,
    evidenceApproved: completed,
    reason: event.notes || 'Catch-up session',
    catchupRoute: event.meetingProvider || event.platform || 'Not specified',
    daysOverdue,
    completedDate: completed ? formatDateLabel(catchupDateIso) : '',
    completedDateIso: completed ? catchupDateIso : '',
  };
}

export interface CatchUpTrendBucket {
  label: string;
  scheduled: number;
  overdue: number;
  completed: number;
}

export function buildCatchUpTrend(items: CatchUpItem[], view: 'week' | 'month', count: number): CatchUpTrendBucket[] {
  const buckets: Array<CatchUpTrendBucket & { start: Date; end: Date }> = [];
  const reference = startOfDay();

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    let start: Date;
    let end: Date;
    let label: string;
    if (view === 'month') {
      start = new Date(reference.getFullYear(), reference.getMonth() - offset, 1);
      end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      label = start.toLocaleDateString('en-GB', { month: 'short' });
    } else {
      const day = reference.getDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      start = new Date(reference);
      start.setDate(reference.getDate() + mondayOffset - offset * 7);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
      label = `${start.getDate()} ${start.toLocaleDateString('en-GB', { month: 'short' })}`;
    }
    buckets.push({ label, scheduled: 0, overdue: 0, completed: 0, start, end });
  }

  items.forEach((item) => {
    const date = parseLocalDate(item.catchupDateIso || item.missedDateIso);
    if (!date) return;
    const bucket = buckets.find((entry) => date >= entry.start && date <= entry.end);
    if (bucket) bucket[item.status] += 1;
  });

  return buckets.map(({ label, scheduled, overdue, completed }) => ({ label, scheduled, overdue, completed }));
}
