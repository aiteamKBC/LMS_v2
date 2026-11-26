import { describe, expect, it } from 'vitest';
import type { LearnerCalendarEvent } from '@/api/learnerCalendar';
import { shouldShowLearnerMeetingRecording } from './recordingVisibility';

const base = {
  eventKey: 'imported-review:42', calendarEventKey: 'learner-book:42',
  meetingLink: 'https://teams.microsoft.test/meeting', reviewSource: 'aptem',
} as LearnerCalendarEvent;

describe('learner MCM recording visibility', () => {
  it.each(['scheduled', 'in-progress', 'awaiting-signature', 'completed'])(
    'shows an associated APTEM recording panel at %s', status => {
      expect(shouldShowLearnerMeetingRecording({ ...base, status })).toBe(true);
    });

  it('requires the exact imported calendar association', () => {
    expect(shouldShowLearnerMeetingRecording({ ...base, calendarEventKey: undefined })).toBe(false);
    expect(shouldShowLearnerMeetingRecording({ ...base, meetingLink: '' })).toBe(false);
  });

  it('keeps the Native lifecycle gate', () => {
    expect(shouldShowLearnerMeetingRecording({ ...base, reviewSource: undefined, status: 'scheduled' })).toBe(false);
    expect(shouldShowLearnerMeetingRecording({ ...base, reviewSource: undefined, status: 'completed' })).toBe(true);
  });
});
