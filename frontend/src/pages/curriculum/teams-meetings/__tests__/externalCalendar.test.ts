import { describe, expect, it } from 'vitest';
import type { CurriculumTeamsMeetingSummary } from '@/lib/curriculumApi';
import type { ModuleComponent } from '../../module-builder/moduleAuthoringData';
import { calendarOwnershipKnown, externalCalendarFor } from '../externalCalendar';

const originalLink = 'https://teams.microsoft.com/l/meetup-join/existing-series';
const separateLink = 'https://teams.microsoft.com/l/meetup-join/guest-session';

function component(settings: ModuleComponent['settings']): ModuleComponent {
  return {
    id: 'COMP-1', weekId: 'WEEK-1', type: 'live-session', title: 'Live session',
    description: '', expectedOtjh: 2, points: 0, reflectionRequired: false,
    reflectionQuestion: '', workplaceEvidenceRequired: false, tutorValidationRequired: false,
    coachValidationRequired: true, ksbMappings: [], settings,
  };
}

function summary(extra: Partial<CurriculumTeamsMeetingSummary> = {}): CurriculumTeamsMeetingSummary {
  return {
    moduleCatalogueId: 'MOD-1', liveSessionId: 'LIVE-1', status: 'active',
    joinUrl: originalLink, organizerEmail: 'organiser@example.invalid', repeatPattern: 'weekly',
    startDateTime: '2026-09-04T11:00:00Z', durationMinutes: 120, occurrenceCount: 1,
    upcomingCount: 1, syncedCount: 0, nextOccurrence: '2026-09-04T11:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z', ...extra,
  };
}

describe('existing Teams link protection', () => {
  it.each([
    { meetingType: 'linked-external' },
    { calendarManagement: 'external' as const },
  ])('protects an imported series even before component links arrive: %j', metadata => {
    expect(externalCalendarFor(summary(metadata))).toEqual({
      source: 'imported', joinUrls: [originalLink], canReattach: true,
    });
  });

  it('protects an untracked pasted link without claiming a confirmed calendar', () => {
    expect(externalCalendarFor(undefined, [component({ liveSessionUrl: originalLink })])).toEqual({
      source: 'untracked', joinUrls: [originalLink], canReattach: false,
    });
  });

  it('does not use dates from the old calendar to confirm a replacement link', () => {
    expect(externalCalendarFor(summary({ meetingType: 'linked-external' }), [component({
      liveSessionUrl: originalLink, liveSessionLinkOverride: separateLink,
    })])).toEqual({ source: 'replacement', joinUrls: [separateLink], canReattach: false });
  });

  it('allows reattachment when every main link still belongs to the imported series', () => {
    expect(externalCalendarFor(summary({ meetingType: 'linked-external' }), [
      component({ liveSessionUrl: originalLink }),
      component({ liveSessionLinkOverride: originalLink, teamsMeetingUrl: originalLink }),
    ])).toEqual({ source: 'imported', joinUrls: [originalLink], canReattach: true });
  });

  it('keeps a booked additional meeting out of the main link and calendar comparison', () => {
    const extra = component({
      extraTeamsMeetingUrl: separateLink, liveSessionUrl: separateLink,
      liveSessionLinkOverride: separateLink, teamsMeetingScope: 'additional',
    });
    expect(externalCalendarFor(undefined, [extra])).toBeNull();
    expect(externalCalendarFor(summary({ meetingType: 'linked-external' }), [
      component({ liveSessionUrl: originalLink }), extra,
    ])).toEqual({ source: 'imported', joinUrls: [originalLink], canReattach: true });
  });

  it('excludes an explicitly additional session before it has been booked', () => {
    expect(externalCalendarFor(undefined, [component({
      teamsMeetingScope: 'additional', liveSessionUrl: separateLink,
    })])).toBeNull();
  });

  it('keeps managed calendars editable when their saved join link has not been replaced', () => {
    expect(externalCalendarFor(summary(), [component({
      liveSessionUrl: originalLink, liveSessionLinkOverride: originalLink,
    })])).toBeNull();
    expect(externalCalendarFor(undefined, [component({})])).toBeNull();
  });

  it('does not reattach a mixture of imported and unrelated main links', () => {
    expect(externalCalendarFor(summary({ meetingType: 'linked-external' }), [
      component({ liveSessionUrl: originalLink }), component({ liveSessionUrl: separateLink }),
    ])).toEqual({ source: 'imported', joinUrls: [originalLink, separateLink], canReattach: false });
  });

  it('recognises imported ownership from matching raw series details when the summary omits it', () => {
    const series = { id: 'LIVE-1', meeting_type: 'linked-external' };
    expect(externalCalendarFor(summary(), [component({ liveSessionUrl: originalLink })], series)).toEqual({
      source: 'imported', joinUrls: [originalLink], canReattach: true,
    });
    expect(calendarOwnershipKnown(summary(), series)).toBe(true);
  });

  it('does not borrow imported ownership from another module or an earlier selection', () => {
    const stale = { id: 'OTHER-LIVE', meeting_type: 'linked-external' };
    expect(externalCalendarFor(summary(), [component({ liveSessionUrl: originalLink })], stale)).toBeNull();
    expect(calendarOwnershipKnown(summary(), stale)).toBe(false);
    expect(calendarOwnershipKnown(summary(), { id: 'LIVE-1' })).toBe(false);
  });

  it('accepts explicit managed ownership without labelling an unknown calendar imported', () => {
    expect(calendarOwnershipKnown(summary({ calendarManagement: 'lms' }))).toBe(true);
    expect(calendarOwnershipKnown(summary(), { id: 'LIVE-1', meeting_type: 'live-session' })).toBe(true);
    expect(calendarOwnershipKnown(summary())).toBe(false);
    expect(externalCalendarFor(summary())).toBeNull();
  });
});
