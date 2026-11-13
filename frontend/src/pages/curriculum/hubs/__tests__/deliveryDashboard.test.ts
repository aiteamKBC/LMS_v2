import { describe, expect, it } from 'vitest';
import { deliveryActiveGroupIds, deliveryBusinessClock, deliverySessionTime, deliveryStaffing, deliveryWeek } from '../deliveryDashboard';

describe('Delivery weekly display of saved live-session dates', () => {
  it('counts distinct groups with active assigned modules, using both canonical group relationships', () => {
    const groups = [{ id: 'a', moduleIds: ['active', 'also-active'] }, { id: 'b' }, { id: 'c', moduleIds: ['future'] }, { id: 'empty' }];
    const modules = [{ id: 'allocation', moduleCatalogueId: 'active', groupId: 'b' }];
    const active = new Set(['active', 'also-active']);
    expect([...deliveryActiveGroupIds(groups, modules, active)]).toEqual(['a', 'b']);
    expect(deliveryStaffing([], groups.map(group => ({ ...group, coach: '' })), [], active, '2026-11-13', new Set(['a', 'b'])).needsCoach).toBe(2);
  });
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

  it.each([
    ['2026-07-06', 'Africa/Cairo', '09:00'],
    ['2026-10-28', 'Egypt Standard Time', '08:00'],
    ['2026-10-30', 'Africa/Cairo', '09:00'],
  ])('renders the saved source clock in UK time using event-date rules on %s', (date, timeZone, expectedTime) => {
    const session = Object.freeze({ id: 'foreign', type: 'Live Session', date, startTime: '11:00', timeZone });
    const week = deliveryWeek([session], new Date(`${date}T00:00:00Z`));
    expect(week.next).toMatchObject({ id: 'foreign', date, startTime: expectedTime });
    expect(session.startTime).toBe('11:00');
    expect(session.timeZone).toBe(timeZone);
  });

  it('orders upcoming sessions by their instant across source dates and excludes starts already passed', () => {
    const sessions = [
      { id: 'passed', type: 'Live Session', date: '2026-11-14', startTime: '00:30', timeZone: 'Asia/Dubai' },
      { id: 'next', type: 'Live Session', date: '2026-11-14', startTime: '00:30', timeZone: 'Africa/Cairo' },
      { id: 'later', type: 'Live Session', date: '2026-11-13', startTime: '23:30', timeZone: 'America/New_York' },
    ];
    const week = deliveryWeek(sessions, new Date('2026-11-13T21:00:00Z'));
    expect(week.next).toMatchObject({ id: 'next', date: '2026-11-13', startTime: '22:30' });
    expect(deliveryWeek(sessions, new Date('2026-11-13T23:00:00Z')).next)
      .toMatchObject({ id: 'later', date: '2026-11-14', startTime: '04:30' });
  });

  it('buckets sessions into the UK day and week at both sides of midnight', () => {
    const sessions = [
      { id: 'east', type: 'Live Session', date: '2026-11-16', startTime: '00:30', timeZone: 'Africa/Cairo' },
      { id: 'west', type: 'Live Session', date: '2026-11-15', startTime: '23:30', timeZone: 'America/New_York' },
    ];
    const now = new Date('2026-11-13T10:00:00Z');
    expect(deliveryWeek(sessions, now).days[6]).toMatchObject({ date: '2026-11-15', count: 1 });
    expect(deliveryWeek(sessions, now, 1).days[0]).toMatchObject({ date: '2026-11-16', count: 1 });
  });

  it('uses UK dates for the existing soon-teaching staffing window', () => {
    const modules = [{ id: 'edge', tutor: '' }, { id: 'outside', tutor: '' }];
    const sessions = [
      { id: 'east', type: 'Live Session', moduleId: 'edge', date: '2026-11-27', startTime: '00:30', timeZone: 'Africa/Cairo' },
      { id: 'west', type: 'Live Session', moduleId: 'outside', date: '2026-11-26', startTime: '23:30', timeZone: 'America/New_York' },
    ];
    expect(deliveryStaffing(modules, [], sessions, new Set(), '2026-11-13').needsTutor).toBe(1);
  });

  it.each([
    ['2026-11-13', '09:00', 'Unknown/Zone'],
    ['2026-03-29', '01:30', 'Europe/London'],
    ['2026-10-25', '01:30', 'Europe/London'],
  ])('flags an unresolvable source clock without inventing a UK instant: %s %s %s', (date, startTime, timeZone) => {
    const week = deliveryWeek([{ id: 'check', type: 'Live Session', date, startTime, timeZone }], new Date(`${date}T00:00:00Z`));
    expect(week.next).toBeUndefined();
    expect(week.count).toBe(0);
    expect(week.undated).toBe(0);
    expect(week.invalidTimes).toBe(1);
  });
});
