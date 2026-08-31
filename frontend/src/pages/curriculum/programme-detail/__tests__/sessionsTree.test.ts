import { describe, it, expect } from 'vitest';
import {
  attendanceSheetRows,
  buildSessionTree,
  parseTeamsTranscriptVtt,
  sessionMonthBucket,
} from '../SessionsTree';
import type { DeliverySession } from '../page';

function makeSession(overrides: Partial<DeliverySession>): DeliverySession {
  return {
    id: Math.random().toString(36).slice(2),
    kind: 'live',
    title: 'Live session',
    module: 'Module A',
    moduleCatalogueId: 'MOD-A',
    week: 1,
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

  it('groups undated recordings under the Unscheduled month', () => {
    const tree = buildSessionTree([
      makeSession({ kind: 'recorded', module: 'M', week: 2, dateIso: '', status: 'published' }),
    ]);
    expect(tree[0].months[0].label).toBe('Unscheduled');
    expect(tree[0].months[0].weeks[0].week).toBe(2);
  });
});

describe('completed session artifacts', () => {
  it('turns Microsoft WEBVTT into readable speaker lines', () => {
    const cues = parseTeamsTranscriptVtt(`WEBVTT

00:01:28.033 --> 00:01:28.753
<v Ahmed Lotfi>Cortana.</v>

00:01:31.570 --> 00:01:33.450
<v Ahmed Lotfi>Something &amp; something else.</v>`);

    expect(cues).toEqual([
      { start: '01:28', speaker: 'Ahmed Lotfi', text: 'Cortana.' },
      { start: '01:31', speaker: 'Ahmed Lotfi', text: 'Something & something else.' },
    ]);
  });

  it('builds an Excel-friendly attendance row with intervals and duration', () => {
    const rows = attendanceSheetRows([{
      id: 'ATT-1', occurrence_id: 'OCC-1', display_name: 'Ahmed Lotfi',
      email: 'ahmed@example.com', role: 'presenter', total_attendance_seconds: 1140,
      intervals: [{
        joinDateTime: '2026-08-31T08:00:00Z',
        leaveDateTime: '2026-08-31T08:19:00Z',
      }],
    }]);

    expect(rows).toEqual([expect.objectContaining({
      'Attendee name': 'Ahmed Lotfi',
      Email: 'ahmed@example.com',
      Role: 'presenter',
      'Time in session': '19m',
      'Attendance seconds': 1140,
      'Joined at': '2026-08-31T08:00:00Z',
      'Left at': '2026-08-31T08:19:00Z',
    })]);
  });
});
