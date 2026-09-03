import { describe, it, expect } from 'vitest';
import { buildSessionTree, sessionMonthBucket } from '../SessionsTree';
import type { DeliverySession } from '../page';

function makeSession(overrides: Partial<DeliverySession>): DeliverySession {
  return {
    id: Math.random().toString(36).slice(2),
    kind: 'live',
    title: 'Live session',
    module: 'Module A',
    moduleCatalogueId: 'MOD-A',
    week: 1,
    weekId: 'WEEK-1',
    weekTitle: '',
    weekStartDate: '',
    date: '',
    dateIso: '',
    time: '',
    groups: [],
    url: '',
    provider: '',
    durationMinutes: 60,
    attendanceRequired: true,
    recordingExpected: false,
    ksbRefs: [],
    status: 'scheduled',
    liveSessionId: '',
    occurrenceId: '',
    sessionNumber: 0,
    actualStart: '',
    actualEnd: '',
    participantCount: 0,
    artifactsSyncedAt: '',
    ...overrides,
  };
}

describe('sessionMonthBucket', () => {
  it('buckets a dated session by its UTC month regardless of local zone', () => {
    // Late-evening UTC on the last day of the month must not roll into next month.
    const bucket = sessionMonthBucket('2026-08-31T23:30:00Z');
    expect(bucket.key).toBe('2026-08');
    expect(bucket.label).toBe('August 2026');
  });

  it('keeps a date-only string on its own calendar day', () => {
    const bucket = sessionMonthBucket('2026-08-01');
    expect(bucket.key).toBe('2026-08');
  });

  it('sends undated sessions to a single Unscheduled bucket that sorts last', () => {
    const bucket = sessionMonthBucket('');
    expect(bucket.key).toBe('unscheduled');
    expect(bucket.label).toBe('Unscheduled');
    expect(bucket.order).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('buildSessionTree', () => {
  it('nests Module → Month → Week and preserves programme module order', () => {
    const tree = buildSessionTree([
      makeSession({ module: 'Module B', week: 2, dateIso: '2026-09-05T10:00:00Z', status: 'completed' }),
      makeSession({ module: 'Module A', week: 1, dateIso: '2026-08-10T10:00:00Z', status: 'scheduled' }),
      makeSession({ module: 'Module A', week: 1, dateIso: '2026-08-12T10:00:00Z', status: 'completed' }),
      makeSession({ module: 'Module A', week: 3, dateIso: '2026-09-02T10:00:00Z', status: 'cancelled' }),
    ]);

    // Insertion order: Module B seen first, then Module A.
    expect(tree.map(group => group.module)).toEqual(['Module B', 'Module A']);

    const moduleA = tree.find(group => group.module === 'Module A')!;
    expect(moduleA.count).toBe(3);
    expect(moduleA.completed).toBe(1);
    expect(moduleA.scheduled).toBe(1);
    expect(moduleA.cancelled).toBe(1);

    // Two months for Module A, chronological.
    expect(moduleA.months.map(month => month.key)).toEqual(['2026-08', '2026-09']);
    // Week 1 holds the two August sessions.
    const august = moduleA.months[0];
    expect(august.weeks).toHaveLength(1);
    expect(august.weeks[0].week).toBe(1);
    expect(august.weeks[0].sessions).toHaveLength(2);
  });

  it('sorts sessions within a week chronologically', () => {
    const tree = buildSessionTree([
      makeSession({ id: 'late', module: 'M', week: 1, dateIso: '2026-08-20T10:00:00Z' }),
      makeSession({ id: 'early', module: 'M', week: 1, dateIso: '2026-08-05T10:00:00Z' }),
    ]);
    const week = tree[0].months[0].weeks[0];
    expect(week.sessions.map(session => session.id)).toEqual(['early', 'late']);
  });

  it('buckets a recording by its week start date, since it has no date of its own', () => {
    const tree = buildSessionTree([
      makeSession({ kind: 'recorded', module: 'M', week: 2, dateIso: '', weekStartDate: '2026-09-07', status: 'published' }),
    ]);
    expect(tree[0].months[0].key).toBe('2026-09');
    expect(tree[0].months[0].weeks[0].week).toBe(2);
  });

  it('leaves a recording in Unscheduled only when its week has no plan date either', () => {
    const tree = buildSessionTree([
      makeSession({ kind: 'recorded', module: 'M', week: 2, dateIso: '', weekStartDate: '', status: 'published' }),
    ]);
    expect(tree[0].months[0].label).toBe('Unscheduled');
    expect(tree[0].months[0].weeks[0].week).toBe(2);
  });

  it('counts a week with no Teams meeting as a gap against its own week, not Unscheduled', () => {
    // The placeholder has no meeting and so no date of its own, but it belongs to
    // a real week — filing it under Unscheduled would scatter the gaps away from
    // the weeks that need closing.
    const tree = buildSessionTree([
      makeSession({ kind: 'live', module: 'M', week: 3, dateIso: '', weekStartDate: '2026-09-07', status: 'not-created' }),
      makeSession({ kind: 'live', module: 'M', week: 4, dateIso: '2026-09-14T10:00:00Z', status: 'scheduled' }),
    ]);
    expect(tree[0].missing).toBe(1);
    expect(tree[0].scheduled).toBe(1);
    expect(tree[0].months[0].key).toBe('2026-09');
    expect(tree[0].months[0].weeks.map(week => week.week)).toEqual([3, 4]);
  });

  it('keeps an undated live session in Unscheduled even when its week is dated', () => {
    // A live session's own date *is* its schedule, so a missing one is a gap to
    // show, not something to paper over with the week's plan date.
    const tree = buildSessionTree([
      makeSession({ kind: 'live', module: 'M', week: 2, dateIso: '', weekStartDate: '2026-09-07' }),
    ]);
    expect(tree[0].months[0].label).toBe('Unscheduled');
  });
});
