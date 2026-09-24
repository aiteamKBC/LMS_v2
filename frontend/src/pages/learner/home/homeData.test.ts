import { describe, expect, it } from 'vitest';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import type { OverviewWeek } from '@/api/learnerOverview';
import { greeting, homeActions, upcomingEvents } from './homeData';
describe('student home data', () => {
  it('maps the four secondary actions to existing destinations', () => {
    expect(homeActions.map(item => item.href)).toEqual(['/learner/monthly-submission', '/workspace/learner/dashboard', '/learner/attendance', '/learner/monthly-coaching']);
  });
  it('keeps three undated category slots when no events are available', () => {
    const slots = upcomingEvents();
    expect(slots.map(item => item.kind)).toEqual(['lecture', 'assignment', 'review']);
    expect(slots.every(item => item.date === null)).toBe(true);
  });
  it('selects one event per category in the requested order, excluding past and cancelled events', () => {
    const schedule = { sessions: [{ id: '1', title: 'Personal session', start: '2026-09-15T09:00:00Z', status: 'scheduled' },
      { id: '2', title: 'Cancelled', start: '2026-09-14', status: 'cancelled' },
      { id: '5', title: 'Earlier today', start: '2026-09-13T09:00:00Z', status: 'scheduled' },
      { id: '6', title: 'Completed', start: '2026-09-14', status: 'completed' },
      { id: '7', title: 'Later session', start: '2026-09-16', status: 'scheduled' }], reviews: [
      { id: '8', title: 'Next review', source: 'progress-review', scheduledDate: '2026-09-14', status: 'scheduled' },
      { id: '9', title: 'Later review', source: 'progress-review', scheduledDate: '2026-09-18', status: 'scheduled' },
    ] } as unknown as TrainingPlanDashboard;
    const week = { deadlines: [{ id: '3', title: 'My assignment', date: '2026-09-14', type: 'assignment' },
      { id: '4', title: 'Old assignment', date: '2026-09-01', type: 'assignment' }] } as OverviewWeek;
    expect(upcomingEvents(schedule, week, new Date('2026-09-13T12:00:00Z')).map(item => item.title)).toEqual(['Personal session', 'My assignment', 'Next review']);
  });
  it('keeps the next session module so callers can open its learning activity', () => {
    const schedule = { sessions: [
      { id: 'session-1', moduleId: 'module-12', title: 'Personal session', start: '2026-09-15T09:00:00Z', status: 'scheduled' },
    ], reviews: [] } as unknown as TrainingPlanDashboard;

    expect(upcomingEvents(schedule, null, new Date('2026-09-13T12:00:00Z'))[0]).toMatchObject({
      title: 'Personal session', moduleId: 'module-12',
    });
  });
  it('finds a review beyond many earlier lectures and does not replace categories with coaching or checkpoints', () => {
    const schedule = { sessions: Array.from({ length: 8 }, (_, index) => ({ id: String(index), title: `Lecture ${index}`, start: `2026-09-${15 + index}T09:00:00Z`, status: 'scheduled' })),
      reviews: [
        { id: 'coaching', title: 'Coaching', source: 'mcr', scheduledDate: '2026-09-14', status: 'scheduled' },
        { id: 'support', title: 'Support', source: 'student-support', scheduledDate: '2026-09-14', status: 'scheduled' },
        { id: 'review', title: 'Progress review', source: 'progress-review', targetDate: '2026-10-10', status: 'not-scheduled' },
      ] } as unknown as TrainingPlanDashboard;
    const week = { deadlines: [
      { id: 'checkpoint', title: 'Checkpoint', date: '2026-09-14', type: 'checkpoint' },
      { id: 'late', title: 'Later assignment', date: '2026-10-20', type: 'assignment' },
      { id: 'next', title: 'Next assignment', date: '2026-09-30', type: 'assignment' },
    ] } as OverviewWeek;
    const result = upcomingEvents(schedule, week, new Date('2026-09-13T12:00:00Z'));
    expect(result.map(item => item.title)).toEqual(['Lecture 0', 'Next assignment', 'Progress review']);
    expect(result[2].detail).toBe('Review to be booked');
  });
  it('keeps a missing assignment slot instead of inserting another lecture', () => {
    const schedule = { sessions: [
      { id: 'first', title: 'First', start: '2026-09-14', status: 'scheduled' },
      { id: 'second', title: 'Second', start: '2026-09-15', status: 'scheduled' },
    ], reviews: [] } as unknown as TrainingPlanDashboard;
    const result = upcomingEvents(schedule, null, new Date('2026-09-13T12:00:00Z'));
    expect(result[0].title).toBe('First');
    expect(result[1]).toMatchObject({ kind: 'assignment', date: null });
    expect(result[2]).toMatchObject({ kind: 'review', date: null });
  });
  it('uses the booked review date and UK time to exclude earlier appointments today', () => {
    const schedule = { sessions: [], reviews: [
      { id: 'past', title: 'Earlier today', source: 'progress-review', scheduledDate: '2026-09-13', scheduledTime: '12:30', status: 'scheduled' },
      { id: 'later', title: 'Later today', source: 'progress-review', scheduledDate: '2026-09-13', scheduledTime: '15:00', status: 'scheduled' },
      { id: 'next', title: 'Next review', source: 'progress-review', scheduledDate: '2026-09-13', scheduledTime: '14:00', targetDate: '2026-10-01', status: 'scheduled' },
    ] } as unknown as TrainingPlanDashboard;
    expect(upcomingEvents(schedule, null, new Date('2026-09-13T12:00:00Z'))[2].title).toBe('Next review');
  });
  it('excludes invalid dates and reviews that are completed or awaiting signatures', () => {
    const schedule = { sessions: [], reviews: [
      { id: 'invalid', title: 'Invalid', source: 'progress-review', scheduledDate: 'invalid', status: 'scheduled' },
      ...['completed', 'awaiting-signature', 'cancelled', 'canceled', 'deleted'].map(status => (
        { id: status, title: status, source: 'progress-review', scheduledDate: '2026-09-15', status }
      )),
    ] } as unknown as TrainingPlanDashboard;
    expect(upcomingEvents(schedule, null, new Date('2026-09-13T12:00:00Z'))[2].date).toBeNull();
  });
  it('retains a date-only assignment until the end of its UK due day', () => {
    const week = { deadlines: [{ id: 'today', title: 'Due today', date: '2026-09-13', type: 'assignment' }] } as OverviewWeek;
    expect(upcomingEvents(null, week, new Date('2026-09-13T22:30:00Z'))[1].title).toBe('Due today');
    expect(upcomingEvents(null, week, new Date('2026-09-13T23:30:00Z'))[1].date).toBeNull();
  });
  it('uses the college time zone for the greeting', () => {
    expect(greeting(new Date('2026-09-13T08:00:00Z'))).toBe('Good morning,');
    expect(greeting(new Date('2026-09-13T19:00:00Z'))).toBe('Good evening,');
  });
});
