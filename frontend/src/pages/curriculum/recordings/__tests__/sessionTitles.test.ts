import { describe, expect, it } from 'vitest';
import type { RecordingsLibrary } from '@/api/sessionResults';
import { buildCalendarLectures } from '../model';

function library(): RecordingsLibrary {
  return { deliveries: [], recordingCount: 0, attentionChecked: true, sessions: [{
    occurrenceId: 'O7', seriesId: 'S1', sessionNumber: 7, moduleId: 'M1', moduleTitle: 'Module',
    title: 'Live Teams Session 1', weekId: 'W2', weekNumber: 2, weekTitle: 'Pricing', displayWeekTitle: 'Pricing',
    programme: 'Programme', programmeActive: true, cohort: 'Cohort', group: 'Group',
    startsAt: '2026-11-06T09:00:00Z', endsAt: '2026-11-06T11:00:00Z',
    source: 'occurrence', status: 'scheduled', joinUrl: 'https://teams.microsoft.com/meet/synthetic',
  }] };
}

describe('recordings calendar lecture titles', () => {
  it('uses the linked week and preserves all other lecture fields and input records', () => {
    const input = library();
    const original = structuredClone(input);
    const baseline = structuredClone(input);
    baseline.sessions![0].displayWeekTitle = '';
    const current = buildCalendarLectures(input).lectures[0];
    const previous = buildCalendarLectures(baseline).lectures[0];
    expect(current.title).toBe('Pricing (Live Teams Session)');
    expect({ ...current, title: previous.title }).toEqual(previous);
    expect(input).toEqual(original);
  });

  it.each([undefined, '', '   '])('keeps the stored name when the backend cannot prove a week title', displayWeekTitle => {
    const input = library();
    input.sessions![0].displayWeekTitle = displayWeekTitle;
    expect(buildCalendarLectures(input).lectures[0].title).toBe('Live Teams Session 1');
  });

  it('names a recording-only lecture from a verified link and keeps legacy placement as fallback', () => {
    const input: RecordingsLibrary = { sessions: [], attentionChecked: true, recordingCount: 1, deliveries: [{
      moduleId: 'M1', title: 'Module', programme: 'Programme', programmeActive: true, archived: false, cohort: 'Cohort', group: 'Group',
      recordingCount: 1, attention: [], weeks: [{ weekId: 'W2', weekNumber: 2, title: 'Pricing', recordings: [{
        id: 'A1', seriesId: 'S1', occurrenceId: 'O7', sessionNumber: 7, displayWeekTitle: 'Pricing',
        startsAt: '2026-11-06T09:00:00Z', recordedAt: '2026-11-06T09:01:00Z', endsAt: '2026-11-06T11:00:00Z',
        state: 'ready', status: 'available', duplicateCount: 0, hiddenFromLearners: false,
      }] }],
    }] };
    expect(buildCalendarLectures(input).lectures[0].title).toBe('Pricing (Recording Session)');
    input.deliveries[0].weeks[0].recordings[0].displayWeekTitle = '';
    expect(buildCalendarLectures(input).lectures[0].title).toBe('Module');
  });
});
