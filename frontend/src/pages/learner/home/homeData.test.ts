import { describe, expect, it } from 'vitest';
import type { TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import type { OverviewWeek } from '@/api/learnerOverview';
import { greeting, homeActions, homeUpcomingEvents, upcomingEvents, upcomingReviewOrMcm, withLearner } from './homeData';
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
  it('selects the nearest active MCM or progress review for the learner dashboard action', () => {
    const schedule = { reviews: [
      { id: 'later-review', title: 'Progress review', source: 'progress-review', targetDate: '2026-10-10', status: 'not-scheduled', meetingLink: 'https://teams.microsoft.com/l/meetup-join/later' },
      { id: 'next-mcm', eventKey: 'mcr:12', title: 'Monthly Coaching', source: 'mcr', targetDate: '2026-09-20', status: 'not-scheduled' },
      { id: 'done-mcm', title: 'Completed MCM', source: 'mcr', scheduledDate: '2026-09-15', status: 'completed' },
    ] } as unknown as TrainingPlanDashboard;
    expect(upcomingReviewOrMcm(schedule, new Date('2026-09-13T12:00:00Z'))).toMatchObject({
      source: 'mcr', sessionId: 'next-mcm', eventKey: 'mcr:12', title: 'Monthly Coaching', scheduledDate: null,
    });
  });
  it('keeps a scheduled Teams link for the dashboard action card', () => {
    const schedule = { reviews: [
      { id: 'review-28', title: 'Progress Review', source: 'progress-review', scheduledDate: '2026-09-28', scheduledTime: '09:00', meetingLink: 'https://teams.microsoft.com/l/meetup-join/review-28', status: 'scheduled' },
    ] } as unknown as TrainingPlanDashboard;
    expect(upcomingReviewOrMcm(schedule, new Date('2026-09-24T12:00:00Z'))).toMatchObject({
      scheduledDate: '2026-09-28', meetingLink: 'https://teams.microsoft.com/l/meetup-join/review-28',
    });
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
  it('keeps the server’s chronological Home events and maps each type to its card text and page', () => {
    // Wednesday 14 October 2026; next week is Monday 19 to Friday 23 October.
    const now = new Date('2026-10-14T12:00:00Z');
    const result = homeUpcomingEvents({ events: [
      { id: 'native:a', type: 'assignment', title: 'Essay', date: '2026-10-19' },
      { id: '7', type: 'session', title: 'Lecture', date: '2026-10-20T09:00:00+00:00' },
      { id: 'r', type: 'review', title: 'Review', date: '2026-10-21', booked: false },
      { id: '8', type: 'session', title: 'Lecture 2', date: '2026-10-22T09:00:00+00:00' },
    ] }, now);
    expect(result.map(({ id, kind, detail, href }) => [id, kind, detail, href])).toEqual([
      ['assignment-native:a', 'assignment', 'Assignment due', '/learner/monthly-submission'],
      ['session-7', 'lecture', 'Learning session', '/learner/attendance'],
      ['review-r', 'review', 'Review to be booked', '/learner/calendar'],
      ['session-8', 'lecture', 'Learning session', '/learner/attendance'],
    ]);
    expect(homeUpcomingEvents({ events: [{ id: 'b', type: 'review', title: 'Review', date: '2026-10-23T10:00:00+01:00', booked: true }] },
      now)[0].detail).toBe('Progress review');
  });
  it('handles no Home events', () => {
    expect(homeUpcomingEvents(null)).toEqual([]);
    expect(homeUpcomingEvents({ events: [] })).toEqual([]);
  });
  it('keeps only next week’s UK Monday to Friday, so a cached response from another week drops out', () => {
    const schedule = { events: [
      { id: 'sun', type: 'session' as const, title: 'Sunday', date: '2026-10-18T22:30:00+00:00' },
      // 23:30 UTC on Sunday 18 October is already Monday 00:30 in London (BST).
      { id: 'mon', type: 'session' as const, title: 'Monday', date: '2026-10-18T23:30:00+00:00' },
      { id: 'fri', type: 'assignment' as const, title: 'Friday', date: '2026-10-23' },
      { id: 'sat', type: 'assignment' as const, title: 'Saturday', date: '2026-10-24' },
      { id: 'late', type: 'session' as const, title: 'Friday late', date: '2026-10-23T22:59:00+00:00' },
      { id: 'next', type: 'review' as const, title: 'Following Monday', date: '2026-10-26', booked: false },
    ] };
    expect(homeUpcomingEvents(schedule, new Date('2026-10-14T12:00:00Z')).map(item => item.title))
      .toEqual(['Monday', 'Friday', 'Friday late']);
    // On Monday 19 October those events are this week, so none remain.
    expect(homeUpcomingEvents(schedule, new Date('2026-10-19T08:00:00Z')).map(item => item.title)).toEqual(['Following Monday']);
    // Late Sunday in London still looks to the next day.
    expect(homeUpcomingEvents(schedule, new Date('2026-10-18T22:00:00Z')).map(item => item.title))
      .toEqual(['Monday', 'Friday', 'Friday late']);
  });
  it('uses the college time zone for the greeting', () => {
    expect(greeting(new Date('2026-09-13T08:00:00Z'))).toBe('Good morning,');
    expect(greeting(new Date('2026-09-13T19:00:00Z'))).toBe('Good evening,');
  });
});

describe('withLearner', () => {
  it('names the learner in every Student Home link, keeping any query', () => {
    expect(withLearner('/learner/attendance', 'apprenticeship', '71')).toBe('/learner/attendance/apprenticeship/71');
    expect(withLearner('/workspace/learner/dashboard', 'commercial', '502')).toBe('/workspace/learner/dashboard/commercial/502');
    expect(withLearner('/learner/my-learning?subject=M1', 'apprenticeship', '71')).toBe('/learner/my-learning/apprenticeship/71?subject=M1');
  });
  it('leaves other links, and links without a learner, unchanged', () => {
    expect(withLearner('/learner/profile', 'apprenticeship', '71')).toBe('/learner/profile');
    expect(withLearner('/learner/calendar')).toBe('/learner/calendar');
  });
});
