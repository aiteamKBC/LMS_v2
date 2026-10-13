import { afterEach, expect, it, vi } from 'vitest';
import { adaptDashboardMeetings, dashboardMeetingsQuery, type DashboardMeeting } from './dashboardMeetings';
import { eventDisplayDate, eventPeriodLabel, scheduleDefaults, sortEvents, type CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';
import { slidesTargetFromEvent } from '@/pages/coach/progress-reviews/components/slidesTarget';

afterEach(() => vi.useRealTimers());

it('requests the exact displayed Monday-Friday range using local calendar dates', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 6, 10));
  expect(dashboardMeetingsQuery()).toBe('?from=2026-10-12&to=2026-10-16');
});

it('preserves action identity, form navigation, presentations, labels and schedule defaults without I/O', () => {
  const meeting: DashboardMeeting = { id: '1', type: 'progress-review', date: '2026-10-12', time: '10:30',
    durationMinutes: 60, learner: { id: '2', name: 'Synthetic Learner' }, title: 'Review', programme: 'Programme',
    status: 'scheduled', eventKey: 'pr:2:3', enrolmentId: '4', reviewInstanceId: '5', reviewTemplateId: '6', sequence: 3,
    startHour: 10.5 };
  const original = { meetings: { range: { from: '2026-10-12', to: '2026-10-16' }, events: [meeting] } };
  const adapted = adaptDashboardMeetings(original) as unknown as { meetings: { events: CoachCalendarEvent[] } };
  const event = adapted.meetings.events[0];
  expect(event).toMatchObject({ source: 'progress-review', learner: 'Synthetic Learner', learnerId: '2',
    eventKey: 'pr:2:3', reviewInstanceId: '5', reviewTemplateId: '6' });
  expect(eventDisplayDate(event)).toBe('2026-10-12');
  expect(eventPeriodLabel(event)).toBe('Review 3');
  expect(scheduleDefaults(event)).toEqual({ date: '2026-10-12', time: '10:30', durationMinutes: 60 });
  expect(slidesTargetFromEvent(event)).toMatchObject({ learnerId: '4', meetingDate: '2026-10-12' });
  expect(original.meetings.events[0].learner).toEqual({ id: '2', name: 'Synthetic Learner' });
});

it('preserves live focus identity and labels, MCM aliases and estimated-time ordering', () => {
  const wire = { meetings: { range: {}, events: [
    { id: 'mcm', type: 'mcm', date: '2026-10-12', time: null, status: 'not-scheduled', isTimeEstimated: true, startHour: 9 },
    { id: 'live', eventKey: 'live-focus', type: 'live-session', date: '2026-10-12', time: '09:00',
      status: 'scheduled', startHour: 9, timeLabel: '09:00 - 11:00', cohort: 'Cohort', group: 'Group', meetingLink: 'https://example.invalid/join' },
  ] } };
  const adapted = adaptDashboardMeetings(wire) as unknown as { meetings: { events: CoachCalendarEvent[] } };
  expect(adapted.meetings.events[0].source).toBe('mcr');
  expect(sortEvents(adapted.meetings.events).map(event => event.id)).toEqual(['live', 'mcm']);
  expect(adapted.meetings.events[1]).toMatchObject({ eventKey: 'live-focus', source: 'live-session',
    scheduledTime: '09:00', timeLabel: '09:00 - 11:00', cohort: 'Cohort', group: 'Group' });
});
