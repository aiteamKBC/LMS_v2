import { describe, expect, it } from 'vitest';
import { subjectWeeks, resolveSubjectWeek, groupSubjectActivities, nativeHref, learningDeadlines } from './subjectLearning';
import type { Subject, SubjectEntry } from './learningSummary';
import { createEmptyComponent, createEmptyWeek, groupWeeksByMonth, moduleWeekDeliveryDate } from '@/pages/curriculum/module-builder/moduleAuthoringData';

function activity(id: string, weekId: string, date: string, type = 'reading', moduleId = 'M1'): SubjectEntry {
  return { id, title: id, category: type, completed: id === 'READ', position: 1, week: `Week ${weekId.slice(1)}`,
    schedule: { date, month: date.slice(0, 7), week_start: date, week_end: date, date_source: 'builder_session' },
    native: { componentId: id, title: id, type, expectedOtjh: 1, weekId, moduleId,
      sessionDate: type === 'live_session' ? date : undefined,
      ...(type === 'live_session' ? { liveSessionUrl: 'https://example.org/join' } : {}) } };
}
const subject = (activities: SubjectEntry[]): Subject => ({ id: 'current:M1', title: 'Synthetic module', source: 'current', activities });

describe('one authored week anchored to its live session', () => {
  it('keeps all materials with the October 30 live session across the November boundary', () => {
    const live = activity('LIVE', 'W5', '2026-10-30', 'live_session');
    const read = activity('READ', 'W5', '2026-11-02');
    const next = activity('NEXT', 'W6', '2026-11-06', 'live_session');
    const weeks = subjectWeeks(subject([read, live, next]));
    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toMatchObject({ weekId: 'W5', start: '2026-10-30', end: '2026-11-05', month: '2026-10' });
    expect(weeks[0].activities.map(item => item.id)).toEqual(['LIVE', 'READ']);
    expect(weeks[1]).toMatchObject({ weekId: 'W6', start: '2026-11-06', month: '2026-11' });
    expect(resolveSubjectWeek(weeks, '2026-11-02')).toBe(weeks[0]);
    expect(resolveSubjectWeek(weeks, 'W5')).toBe(weeks[0]);
    expect(groupSubjectActivities([read, live, next]).map(group => [group.month, group.weeks.length])).toEqual([
      ['2026-10', 1], ['2026-11', 1],
    ]);
  });

  it('shows five October Fridays and does not split one week into its two sessions', () => {
    const entries = [2, 9, 16, 23, 30].flatMap((day, index) => {
      const date = `2026-10-${String(day).padStart(2, '0')}`;
      return [activity(`LIVE-${index}`, `W${index + 1}`, date, 'live_session'),
        activity(`READ-${index}`, `W${index + 1}`, date)];
    });
    entries.push(activity('SECOND-SESSION', 'W5', '2026-11-02', 'live_session'));
    const weeks = subjectWeeks(subject(entries));
    expect(weeks).toHaveLength(5);
    expect(weeks.every(week => week.month === '2026-10')).toBe(true);
    expect(weeks[4].activities.map(item => item.id)).toEqual(['LIVE-4', 'READ-4', 'SECOND-SESSION']);
    expect(weeks[4].end).toBe('2026-11-05');
  });

  it('retains separate authored weeks even when their live sessions have the same date', () => {
    const weeks = subjectWeeks(subject([
      activity('A', 'W1', '2026-10-30', 'live_session'), activity('B', 'W2', '2026-10-30', 'live_session'),
    ]));
    expect(weeks.map(week => week.weekId)).toEqual(['W1', 'W2']);
    expect(new Set(weeks.map(week => week.id)).size).toBe(2);
    expect(resolveSubjectWeek(weeks, '2026-10-30')).toBeUndefined();
  });

  it('scopes repeated week identifiers by module and keeps original content, recordings, completion and deadlines', () => {
    const live = activity('LIVE', 'W1', '2026-10-30', 'live_session');
    const read = activity('READ', 'W1', '2026-11-02');
    const assignment = activity('DUE', 'W1', '2026-11-02', 'assignment');
    const recording = activity('RECORDING', 'W1', '2026-11-03', 'recording_placeholder');
    recording.native = { ...recording.native!, recordingSeriesId: 'SERIES', recordingSessionNumber: 5,
      recordingDate: '2026-10-30', pointNumber: 3 };
    assignment.schedule = { ...assignment.schedule, due_timing: 'end of week', week_end: '2026-11-08' };
    const other = activity('OTHER', 'W1', '2026-10-30', 'live_session', 'M2');
    const data = subject([live, read, assignment, recording, other]);
    const before = JSON.stringify(data);
    const weeks = subjectWeeks(data);
    expect(weeks).toHaveLength(2);
    expect(weeks[0].activities).toContain(live);
    expect(weeks[0].activities).toContain(read);
    expect(weeks[0].activities).toContain(recording);
    expect(weeks[0].activities).not.toContain(other);
    expect(weeks[0].activities.filter(item => item.completed).map(item => item.id)).toEqual(['READ']);
    expect(nativeHref(live, 'commercial', 'synthetic')).toContain('/LIVE?');
    expect(nativeHref(recording, 'commercial', 'synthetic')).toContain('/RECORDING?');
    expect(learningDeadlines([data], '2026-10-01')[0].date).toBe('2026-11-08');
    expect(JSON.stringify(data)).toBe(before);
  });
});

describe('curriculum month presentation follows the linked live session', () => {
  it('keeps a confirmed October occurrence under October without rewriting its planned week or settings', () => {
    const week = { ...createEmptyWeek('M1', 5), id: 'W5', sessionDate: '2026-11-02', components: [
      { ...createEmptyComponent('W5', 'live-session', 1), id: 'LIVE', settings: { sessionDate: '2026-10-30',
        teamsLiveSessionId: 'SERIES', teamsSessionNumber: 5 } },
    ] };
    const before = JSON.stringify(week);
    expect(groupWeeksByMonth([week])[0].key).toBe('2026-10');
    expect(JSON.stringify(week)).toBe(before);
  });

  it('uses the UK day of the primary occurrence and leaves a separate meeting outside the anchor choice', () => {
    const week = { ...createEmptyWeek('M1', 5), sessionDate: '2026-11-02', components: [
      { ...createEmptyComponent('W5', 'live-session', 1), settings: { sessionDate: '2026-09-29', extraTeamsMeetingUrl: 'https://example.invalid/extra' } },
      { ...createEmptyComponent('W5', 'live-session', 2), settings: { sessionDate: '2026-09-30', sessionDateTimeUtc: '2026-09-30T23:30:00Z' } },
    ] };
    expect(moduleWeekDeliveryDate(week)).toBe('2026-10-01');
    expect(groupWeeksByMonth([week])[0].key).toBe('2026-10');
  });

  it('uses a content-only week plan and leaves an unscheduled week without a fabricated date', () => {
    expect(moduleWeekDeliveryDate({ ...createEmptyWeek('M1', 1), sessionDate: '2026-10-30' })).toBe('2026-10-30');
    expect(moduleWeekDeliveryDate(createEmptyWeek('M1', 1))).toBe('');
  });
});

describe('authoritative delivery metadata', () => {
  it('keeps Introduction outside the teaching week boundaries', () => {
    const live = activity('LIVE', 'W1', '2026-10-23', 'live_session');
    const intro = activity('WELCOME', 'INTRO', '2026-10-26');
    intro.schedule = { date: null, month: 'undated', date_source: 'introduction', delivery_week: {
      id: 'INTRO', module_id: 'M1', start: '2026-10-26', end: '2026-11-01', month: '2026-10',
    } };
    const weeks = subjectWeeks(subject([live, intro]));
    expect(weeks[0]).toMatchObject({ id: 'introduction', start: null, end: null });
    expect(weeks[1]).toMatchObject({ start: '2026-10-23', end: '2026-10-29' });
  });
  it('keeps the published end before an empty or unpublished next week', () => {
    const entry = activity('LIVE', 'W5', '2026-10-30', 'live_session');
    entry.schedule.delivery_week = { id: 'W5', module_id: 'M1', start: '2026-10-30', end: '2026-11-01', month: '2026-10' };
    expect(subjectWeeks(subject([entry]))[0].end).toBe('2026-11-01');
  });
  it('keeps the primary anchor when a secondary session is returned before it', () => {
    const secondary = activity('SECONDARY', 'W5', '2026-11-02', 'live_session');
    const primary = activity('PRIMARY', 'W5', '2026-10-30', 'live_session');
    const read = activity('READ', 'W5', '2026-11-02');
    for (const entry of [secondary, primary, read]) entry.schedule.delivery_week = {
      id: 'W5', module_id: 'M1', start: '2026-10-30', end: '2026-11-05', month: '2026-10',
    };
    const weeks = subjectWeeks(subject([secondary, primary, read]));
    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toMatchObject({ start: '2026-10-30', end: '2026-11-05', month: '2026-10' });
  });

  it('does not accept delivery metadata naming another module or week', () => {
    const entry = activity('PRIMARY', 'W5', '2026-10-30', 'live_session');
    entry.schedule.delivery_week = { id: 'OTHER', module_id: 'M2', start: '2026-12-04', end: '2026-12-10', month: '2026-12' };
    expect(subjectWeeks(subject([entry]))[0]).toMatchObject({ weekId: 'W5', start: '2026-10-30', month: '2026-10' });
  });
});
