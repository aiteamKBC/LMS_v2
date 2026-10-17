import { describe, expect, it } from 'vitest';
import { periodBounds, sessionMatches, matchesLectureQuery } from '../filters';
import type { Lecture } from '../types';

const lecture: Lecture = { id: 'M:O', moduleId: 'M', title: 'Analysis', date: '2026-10-14', startTime: '09:00', endTime: '11:00',
  startsAt: '2026-10-14T08:00:00Z', endsAt: '2026-10-14T10:00:00Z', programme: 'Level 4', cohort: 'October',
  group: 'Group A', module: 'Data', week: 2, weekTitle: 'Introduction', archived: false, programmeActive: true, status: 'unsynced', recordings: [] };

describe('Recording agenda date and status filters', () => {
  it('uses Monday to Sunday across month and year boundaries', () => {
    expect(periodBounds('2026-11-01', 'week')).toEqual({ start: '2026-10-26', end: '2026-11-01' });
    expect(periodBounds('2026-11-01', 'workWeek')).toEqual({ start: '2026-10-26', end: '2026-10-30' });
    expect(periodBounds('2027-01-01', 'week')).toEqual({ start: '2026-12-28', end: '2027-01-03' });
    expect(periodBounds('2028-02-12', 'month')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(periodBounds('2026-10-14', 'day')).toEqual({ start: '2026-10-14', end: '2026-10-14' });
  });
  it('ends at the UTC end instant regardless of viewing zone or recording readiness', () => {
    expect(sessionMatches(lecture, 'ended', Date.parse('2026-10-14T09:59:59Z'))).toBe(false);
    expect(sessionMatches(lecture, 'ended', Date.parse('2026-10-14T10:00:00Z'))).toBe(true);
    expect(sessionMatches({ ...lecture, status: 'ready' }, 'ended', Date.parse('2026-10-14T09:00:00Z'))).toBe(false);
    expect(sessionMatches({ ...lecture, status: 'cancelled' }, 'ended', Date.parse('2026-10-15'))).toBe(false);
    expect(sessionMatches({ ...lecture, endsAt: null }, 'ended', Date.parse('2026-10-15'))).toBe(false);
  });
  it('does not consider a running session upcoming and searches across descriptive fields', () => {
    expect(sessionMatches(lecture, 'upcoming', Date.parse('2026-10-14T07:00:00Z'))).toBe(true);
    expect(sessionMatches(lecture, 'upcoming', Date.parse('2026-10-14T09:00:00Z'))).toBe(false);
    expect(sessionMatches(lecture, 'notEnded', Date.parse('2026-10-14T09:00:00Z'))).toBe(true);
    expect(sessionMatches(lecture, 'notEnded', Date.parse('2026-10-14T10:00:00Z'))).toBe(false);
    expect(matchesLectureQuery(lecture, 'group   a')).toBe(true);
    expect(matchesLectureQuery(lecture, 'October')).toBe(true);
    expect(matchesLectureQuery(lecture, 'Introduction')).toBe(true);
    expect(matchesLectureQuery(lecture, 'Group B')).toBe(false);
  });
});
