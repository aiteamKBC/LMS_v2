import { describe, expect, it } from 'vitest';
import { deliveryBusinessClock, deliverySessionTime, deliveryStaffing, deliveryWeek } from '../deliveryDashboard';

describe('Delivery weekly display of saved live-session dates', () => {
  it('uses the UK business day near midnight instead of the developer or viewer time zone', () => {
    const now = new Date('2026-11-01T23:30:00Z');
    expect(deliveryBusinessClock(now)).toEqual({ date: '2026-11-01', time: '23:30' });
    const week = deliveryWeek([], now);
    expect(week.days[0].date).toBe('2026-10-26');
    expect(week.days[6].date).toBe('2026-11-01');
    expect(deliveryWeek([], now, 1).days[0].date).toBe('2026-11-02');
  });

  it('applies BST to the business clock while retaining supplied calendar dates', () => {
    const now = new Date('2026-07-05T23:30:00Z');
    expect(deliveryBusinessClock(now)).toEqual({ date: '2026-07-06', time: '00:30' });
    const week = deliveryWeek([{ id: 's1', type: 'Live Session', date: '2026-07-06', startTime: '09:00' }], now);
    expect(week.days[0]).toMatchObject({ date: '2026-07-06', count: 1 });
    expect(week.count).toBe(1);
  });

  it('retains seven dates over a daylight-saving change and a year boundary', () => {
    expect(deliveryWeek([], new Date('2026-03-27T12:00:00Z')).days.map(day => day.date)).toEqual([
      '2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29',
    ]);
    const week = deliveryWeek([], new Date('2026-12-31T12:00:00Z'));
    expect(week.days[0].date).toBe('2026-12-28'); expect(week.days[6].date).toBe('2027-01-03');
  });

  it('keeps simultaneous sessions separate, excluding repeated identities, cancellations and other content', () => {
    const sessions = [
      { id: 'a', type: 'Live Session', date: '2026-11-13', startTime: '11:00' },
      { id: 'b', type: 'live-session', date: '2026-11-13', startTime: '11:00' },
      { id: 'a', type: 'Live Session', date: '2026-11-13', startTime: '11:00' },
      { id: 'c', type: 'Live Session', date: '2026-11-13', status: 'cancelled' },
      { id: 'q', type: 'Quiz', date: '2026-11-13' },
    ];
    const week = deliveryWeek(sessions, new Date('2026-11-13T10:00:00Z'));
    expect(week.count).toBe(2); expect(week.total).toBe(2); expect(week.days[4].count).toBe(2);
  });

  it('reports invalid dates without putting a live session on an invented day', () => {
    const week = deliveryWeek([{ id: 'bad', type: 'Live Session', date: '2026-02-30' }], new Date('2026-02-28T10:00:00Z'));
    expect(week.count).toBe(0); expect(week.undated).toBe(1); expect(week.next).toBeUndefined();
  });

  it('finds the next actual start, keeps missing times explicit, and does not fabricate a default hour', () => {
    const sessions = [
      { id: 'past', type: 'Live Session', date: '2026-11-13', startTime: '09:00' },
      { id: 'next', type: 'Live Session', date: '2026-11-13', startTime: '11:00 AM' },
      { id: 'later', type: 'Live Session', date: '2026-11-14' },
    ];
    expect(deliveryWeek(sessions, new Date('2026-11-13T10:00:00Z')).next?.id).toBe('next');
    expect(deliverySessionTime('12:30 AM')).toBe('00:30');
    expect(deliverySessionTime('1:05 PM')).toBe('13:05');
    expect(deliverySessionTime(undefined)).toBe('Time not set');
    expect(deliverySessionTime('25:00')).toBe('Time not set');
  });

  it('limits tutor needs to active or soon-teaching modules and coach needs to active groups', () => {
    const modules = [
      { id: 'active', tutor: 'TBC' }, { id: 'soon', tutor: '' }, { id: 'unused-draft', tutor: '' },
      { id: 'free', tutor: '', isFreeCourse: true }, { id: 'staffed', tutor: 'Example tutor' },
    ];
    const groups = [{ status: 'active', coach: '' }, { status: 'planned', coach: '' }, { status: 'active', coach: 'Example coach' }];
    const sessions = [
      { id: 's1', type: 'Live Session', date: '2026-11-26', moduleCatalogueId: 'soon' },
      { id: 's2', type: 'Live Session', date: '2026-11-27', moduleCatalogueId: 'unused-draft' },
      { id: 's3', type: 'Live Session', date: '2026-11-20', moduleCatalogueId: 'unused-draft', status: 'cancelled' },
    ];
    expect(deliveryStaffing(modules, groups, sessions, new Set(['active', 'free', 'staffed']), '2026-11-13')).toEqual({ needsTutor: 2, needsCoach: 1 });
  });
});
