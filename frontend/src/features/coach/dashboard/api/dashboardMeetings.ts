import type { CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';
import { getNextWorkWeekRange } from './dashboardWeek';

export type DashboardMeeting = Omit<CoachCalendarEvent, 'learner' | 'source'> & {
  time: string | null;
  learner?: { id: string; name: string };
};

export function dashboardMeetingsQuery() {
  const { start, end } = getNextWorkWeekRange();
  const iso = (day: Date) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  return `?from=${iso(start)}&to=${iso(end)}`;
}

// Adapt locally so existing row actions/rendering share their established DTO.
// No detail fetches are needed, including when opening forms or presentations.
export function adaptDashboardMeetings<Response>(response: Response): Response {
  const wire = response as { meetings?: { range?: unknown; events?: DashboardMeeting[] } };
  if (!wire.meetings?.range) return response; // Older server during rollout.
  return { ...response, meetings: { ...wire.meetings, events: wire.meetings.events?.map(event => ({
    ...event,
    source: event.type === 'mcm' ? 'mcr' : event.type,
    type: event.type === 'mcm' ? 'coaching' : event.type === 'progress-review' ? 'review' : event.type,
    learner: event.learner?.name,
    learnerId: event.learner?.id,
    scheduledDate: event.date,
    scheduledTime: event.time,
  })) } } as Response;
}
