import { describe, expect, it } from 'vitest';
import type { PlanReview, PlanSession, TrainingPlanDashboard } from '@/api/trainingPlanDashboard';
import { upcomingItems, weekSessions } from '../overviewSchedule';

const now = Date.parse('2026-09-12T10:00:00Z');
const session = (id: string, start: string, status = 'scheduled'): PlanSession => ({ id, moduleId: 'M1', title: id, start, end: null, minutes: 60, joinUrl: null, status, attended: null });
const review = (id: string, date: string, extra: Partial<PlanReview> = {}): PlanReview => ({ id, eventKey: id, title: 'Monthly Coaching', source: 'mcr', sequence: 1, status: 'not-scheduled', date, targetDate: date, scheduledDate: null, scheduledTime: null, durationMinutes: 60, coachName: 'Coach', invited: false, ...extra });
const schedule = (sessions: PlanSession[] = [], reviews: PlanReview[] = []) => ({ sessions, reviews } as TrainingPlanDashboard);

describe('overview dates', () => {
  it('sorts real dates across sources and removes cancelled, completed and past events', () => {
    const data = schedule([session('live', '2026-09-14T13:00:00Z'), session('past', '2026-09-10T13:00:00Z'), session('cancelled', '2026-09-13T13:00:00Z', 'cancelled')],
      [review('review', '2026-09-16'), review('done', '2026-09-13', { status: 'completed' })]);
    const items = upcomingItems(data, [{ id: 'assignment', title: 'Portfolio', type: 'assignment', date: '2026-09-13', subjectId: 'current:M1' }], now);
    expect(items.map(item => item.id)).toEqual(['due:assignment', 'live:live', 'review:review']);
  });
  it('keeps date-only deadlines today and rejects meetings that already started in UK time', () => {
    const items = upcomingItems(schedule([], [review('old', '2026-09-12', { scheduledDate: '2026-09-12', scheduledTime: '10:30', status: 'scheduled' }), review('due', '2026-09-12')]), [], now);
    expect(items.map(item => item.id)).toEqual(['review:due']);
    expect(items[0]).toMatchObject({ status: 'To book', time: undefined });
  });
  it('uses a rescheduled date and distinguishes an unconfirmed invitation', () => {
    const item = upcomingItems(schedule([], [review('moved', '2026-09-11', { scheduledDate: '2026-09-15', scheduledTime: '14:00', status: 'scheduled' })]), [], now)[0];
    expect(item).toMatchObject({ date: '2026-09-15', time: '14:00', status: 'Booking pending' });
  });
  it('does not give a generated target the stale scheduled time', () => {
    const item = upcomingItems(schedule([], [review('target', '2026-09-16', { scheduledTime: '14:00' })]), [], now)[0];
    expect(item.time).toBeUndefined();
  });
  it('deduplicates and limits the list to five closest dates', () => {
    const reviews = Array.from({ length: 8 }, (_, i) => review(`r${i}`, `2026-09-${20 + i}`));
    const items = upcomingItems(schedule([], [...reviews, reviews[0]]), [], now);
    expect(items).toHaveLength(5);
    expect(items.at(-1)?.id).toBe('review:r4');
  });
  it('places a late UTC occurrence in the correct UK teaching week', () => {
    const late = session('late', '2026-09-13T23:30:00Z');
    expect(weekSessions([late], '2026-09-07', '2026-09-13', now)).toBeNull();
    expect(weekSessions([late], '2026-09-14', '2026-09-20', now)?.id).toBe('late');
    expect(upcomingItems(schedule([late]), [], now)[0]).toMatchObject({ date: '2026-09-14', time: '00:30' });
  });
  it('keeps the current week session separate from upcoming sessions', () => {
    const sessions = [session('this-week', '2026-09-09T13:00:00Z', 'completed'), session('next-week', '2026-09-16T13:00:00Z')];
    expect(weekSessions(sessions, '2026-09-07', '2026-09-13', now)?.id).toBe('this-week');
    expect(upcomingItems(schedule(sessions), [], now)[0].id).toBe('live:next-week');
  });
});
