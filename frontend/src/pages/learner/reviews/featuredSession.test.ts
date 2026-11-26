import { describe, expect, it } from 'vitest';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import { featuredSession, meetingTimeRange, meetingJoinUrl } from './featuredSession';

const session = (id: string, date: string, overrides: Partial<LearnerCalendarEvent> = {}): LearnerCalendarEvent => ({
  id, eventKey: id, title: id, source: 'mcr', type: 'coaching', sequence: 1, status: 'scheduled', date,
  targetDate: date, scheduledDate: date, scheduledTime: '10:00', durationMinutes: 90,
  coachName: 'Coach', coachEmail: '', meetingLink: '', meetingProvider: '', notes: '', ...overrides,
});
describe('featured programme meeting', () => {
  it('chooses today ahead of a later booking regardless of sequence or row order', () => {
    const today = session('today', '2026-09-14');
    expect(featuredSession([session('future', '2026-10-01'), today], '2026-09-14')).toBe(today);
  });
  it('ignores completed, cancelled and historical meetings', () => {
    expect(featuredSession([session('old', '2026-09-13'), session('cancelled', '2026-09-14', { status: 'cancelled' }),
      session('done', '2026-09-14', { status: 'completed' })], '2026-09-14')).toBeNull();
  });
  it('uses the next booked meeting before a target date and falls back to a booking reminder', () => {
    const target = session('target', '2026-09-14', { status: 'not-scheduled', scheduledDate: null, scheduledTime: null });
    const booked = session('booked', '2026-09-20');
    expect(featuredSession([target, booked], '2026-09-14')).toBe(booked);
    expect(featuredSession([target], '2026-09-14')).toBe(target);
    expect(meetingTimeRange(target)).toBe('To be confirmed');
  });
  it('calculates the end time and rejects unsafe meeting links', () => {
    expect(meetingTimeRange(session('meeting', '2026-09-14'))).toBe('10:00 – 11:30');
    expect(meetingJoinUrl(session('meeting', '2026-09-14', { meetingLink: 'javascript:alert(1)' }))).toBeNull();
    expect(meetingTimeRange(session('meeting', '2026-09-14', { scheduledTime: '23:30' }))).toBe('23:30 – 01:00 (next day)');
  });
});
