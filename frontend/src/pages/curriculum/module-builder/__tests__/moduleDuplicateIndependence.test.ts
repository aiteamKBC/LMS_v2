import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyModuleWeekSessionPlan,
  createEmptyComponent,
  createEmptyWeek,
  createLocalModuleDraft,
  duplicateModuleStructure,
  moduleAuthoredLiveSessions,
  recalculateModule,
  type ModuleCatalogueItem,
  type ModuleWeekSessionPlan,
} from '../moduleAuthoringData';

/**
 * Duplicating a module has to produce a module, not a second name for the first
 * one.
 *
 * A copy carried its components' settings forward wholesale, and two of those
 * settings do not describe the component at all -- they describe one delivery of
 * it. `sessionDate` is the day the ORIGINAL runs on, and `teamsLiveSessionId` is
 * a row in `curriculum.live_sessions`: the original's actual Teams meeting, with
 * its join link, its occurrences, its attendance and its recordings hanging off
 * it.
 *
 * Both survived the copy, and the result was a module that could not be
 * scheduled. `applyModuleWeekSessionPlan` only ever dates a component that has
 * no date and no tracked occurrence -- it must never overwrite a date an author
 * chose or a meeting already booked -- so a copy holding the source's date was
 * permanently stuck on it. The rail showed the new module's own plan while its
 * components, the Teams create-form and `/curriculum/sessions/` all showed the
 * original's dates, months or years away.
 *
 * Reported against a 17-week module starting 18 September 2026 whose components
 * all held Thursdays in December 2027 - February 2028, four of them on one day.
 */

/** A module with a real Teams booking on it, as the source of a copy. */
function bookedModule(): ModuleCatalogueItem {
  const draft = createLocalModuleDraft({
    programme: 'Project Controls Professional Level 6',
    title: 'Risk Management',
    description: 'Risk foundations',
    weeks: 2,
    status: 'published',
    catalogueId: 'MOD-SOURCE',
    startDate: '2027-12-02',
  });
  const weeks = draft.weekStructure.map((week, index) => {
    const live = createEmptyComponent(week.id, 'live-session', 1);
    return {
      ...week,
      sessionDate: index === 0 ? '2027-12-02' : '2027-12-16',
      sessionDay: 'Thursday',
      components: [{
        ...live,
        settings: {
          ...live.settings,
          // The original's delivery: its date, and the meeting Microsoft made.
          sessionDate: index === 0 ? '2027-12-02' : '2027-12-16',
          sessionDay: 'Thursday',
          sessionDateTimeUtc: index === 0 ? '2027-12-02T12:00:00Z' : '2027-12-16T12:00:00Z',
          teamsLiveSessionId: 'LIVE-SOURCE-1',
          teamsSessionNumber: index + 1,
          teamsEventId: 'EVENT-SOURCE-1',
          teamsOnlineMeetingId: 'ONLINE-SOURCE-1',
          teamsCalendarSeries: '[{"day":"Thursday","joinUrl":"https://teams.microsoft.com/source"}]',
          teamsMeetingUrl: 'https://teams.microsoft.com/source',
          liveSessionUrl: 'https://teams.microsoft.com/source',
          teamsMeetingOptionsUrl: 'https://teams.microsoft.com/options/source',
          teamsProvider: 'microsoft',
          // The rest of what the Teams attachment path stamps per occurrence.
          teamsOccurrenceId: 'OCC-SOURCE-1',
          teamsWebLink: 'https://outlook.office.com/calendar/source',
          teamsStartDateTimeUtc: index === 0 ? '2027-12-02T12:00:00Z' : '2027-12-16T12:00:00Z',
          teamsDurationMinutes: '120',
          sessionRescheduled: true,
          // Authoring, not delivery. These are the author's own choices and a
          // copy that dropped them would only have to be typed again.
          sessionPurpose: 'Risk foundations, benefits and VUCA',
          sessionTime: '12:00',
          durationMinutes: 120,
          teamsOrganizerEmail: 'organiser@example.invalid',
          teamsLobbyBypass: 'organizer',
          teamsRecording: 'record-transcribe',
          // Placing a copy into another cohort is a different feature; a
          // duplicate must not inherit where the original was placed.
          placedCopyModuleCatalogueIds: ['MOD-ELSEWHERE'],
          selectedGroupKeys: ['group-source'],
        },
      }],
    };
  });
  return recalculateModule({
    ...draft,
    weekStructure: weeks,
    // What the structure endpoint hangs on a module that has a booked meeting:
    // `teams_delivery_metadata_from_weeks` reads the first live-session
    // component and copies its Microsoft ids up to module level. So this is not
    // a fixture convenience -- it is on every module the builder loads before
    // duplicating one, and it names the ORIGINAL's live_sessions row.
    deliveryMetadata: {
      cohortId: '',
      cohort: '',
      groupId: '',
      group: '',
      weekDays: 'Thursday',
      startTime: '12:00',
      endTime: '14:00',
      teamsLiveSessionId: 'LIVE-SOURCE-1',
      teamsEventId: 'EVENT-SOURCE-1',
      teamsOnlineMeetingId: 'ONLINE-SOURCE-1',
      teamsMeetingUrl: 'https://teams.microsoft.com/source',
      liveSessionUrl: 'https://teams.microsoft.com/source',
      teamsWebLink: 'https://outlook.office.com/calendar/source',
      teamsMeetingOptionsUrl: 'https://teams.microsoft.com/options/source',
      teamsStartDateTimeUtc: '2027-12-02T12:00:00Z',
      teamsOrganizerEmail: 'organiser@example.invalid',
    },
    // The original was imported from a training-plan row; that row is the
    // original's identity, not something a copy gets a second claim on.
    sourceType: 'training_plan',
    sourceId: 'TRAINING-SOURCE-1',
    structureRevision: 'rev-source-1',
  });
}

/** The two Fridays the COPY's own start date puts it on. */
function fridayPlan(): ModuleWeekSessionPlan {
  const dates = ['2026-09-18', '2026-09-25'];
  return {
    sessions: dates.map((date, index) => ({
      sessionNumber: index + 1,
      weekNumber: index + 1,
      date,
      day: 'Friday',
      skippedHolidays: [],
    })),
    skippedHolidays: [],
    finalEndDate: dates[dates.length - 1],
    warnings: [],
  };
}

/** The structure body the copy was saved with. */
let savedStructure: ModuleCatalogueItem;

beforeEach(() => {
  savedStructure = undefined as unknown as ModuleCatalogueItem;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    const path = String(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    if (path.endsWith('/curriculum/modules/')) {
      return { ok: true, status: 201, json: async () => ({ created: true, moduleCatalogueId: 'MOD-COPY' }) };
    }
    if (path.includes('/structure/')) {
      savedStructure = body;
      return { ok: true, status: 200, json: async () => body };
    }
    throw new Error(`Unexpected request: ${path}`);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a duplicated module is its own module', () => {
  it('copies no date and no Teams meeting from the module it was duplicated from', async () => {
    const source = bookedModule();
    await duplicateModuleStructure(source);

    const copied = savedStructure.weekStructure.flatMap(week => (
      week.components.filter(component => component.type === 'live-session')
    ));
    expect(copied).toHaveLength(2);
    copied.forEach(component => {
      const settings = component.settings || {};
      // Dropped keys come back as the component type's own empty default, so
      // "carries nothing" is an empty value here, not an absent one. Empty is
      // what matters: `applyModuleWeekSessionPlan` treats a falsy `sessionDate`
      // as undated and will date it, which a stale date would have prevented.
      const carried = (key: string) => String(settings[key] ?? '');
      // Undated, so the copy's own plan is free to date it.
      expect(carried('sessionDate')).toBe('');
      expect(carried('sessionDay')).toBe('');
      expect(carried('sessionDateTimeUtc')).toBe('');
      // And pointing at no meeting, so nothing it does reaches the original's.
      expect(carried('teamsLiveSessionId')).toBe('');
      expect(carried('teamsEventId')).toBe('');
      expect(carried('teamsOnlineMeetingId')).toBe('');
      expect(carried('teamsCalendarSeries')).toBe('');
      expect(carried('teamsMeetingUrl')).toBe('');
      expect(carried('liveSessionUrl')).toBe('');
      expect(carried('teamsMeetingOptionsUrl')).toBe('');
      expect(carried('teamsSessionNumber')).toBe('');
      // Including the rest of what the attachment path stamps per occurrence:
      // the Graph instance, the link into the original's calendar entry, the
      // booked length and the instant Microsoft holds it at.
      expect(carried('teamsOccurrenceId')).toBe('');
      expect(carried('teamsWebLink')).toBe('');
      expect(carried('teamsDurationMinutes')).toBe('');
      expect(carried('teamsStartDateTimeUtc')).toBe('');
      expect(settings.sessionRescheduled ?? false).toBe(false);
      // Nor where the original had been placed.
      expect(settings.placedCopyModuleCatalogueIds).toBeUndefined();
      expect(settings.selectedGroupKeys).toBeUndefined();
    });
    // The weeks' own rail dates go with them.
    expect(savedStructure.weekStructure.map(week => week.sessionDate)).toEqual(['', '']);
    // And so does the run they were counted from. Every date this module will
    // ever have is generated forward from `start_date`, so a copy that kept the
    // original's start date could only ever be re-dated back onto the original's
    // days -- including after it was assigned to a group that runs elsewhere,
    // which supplies delivery days but no start date of its own.
    expect(String(savedStructure.startDate ?? '')).toBe('');
    expect(String(savedStructure.endDate ?? '')).toBe('');
    // The original is untouched by having been copied.
    expect(source.weekStructure[0].components[0].settings.sessionDate).toBe('2027-12-02');
    expect(source.weekStructure[0].components[0].settings.teamsLiveSessionId).toBe('LIVE-SOURCE-1');
  });

  it('does not carry the original s meeting up at module level either', async () => {
    // Stripping the components was not enough. The structure endpoint copies the
    // first live session's Microsoft ids onto `deliveryMetadata`, and the save
    // sends the whole module back -- so the copy's payload still named
    // `LIVE-SOURCE-1`. The backend does not read that as description:
    // `link_live_session_series_to_module` points every live_sessions row the
    // payload mentions at the module being saved, so duplicating MOVED the
    // original's real meeting onto the copy, and the Teams Meetings page,
    // attendance and recordings followed it there.
    const source = bookedModule();
    await duplicateModuleStructure(source);

    const metadata = (savedStructure.deliveryMetadata || {}) as Record<string, unknown>;
    const carried = (key: string) => String(metadata[key] ?? '');
    expect(carried('teamsLiveSessionId')).toBe('');
    expect(carried('teamsEventId')).toBe('');
    expect(carried('teamsOnlineMeetingId')).toBe('');
    expect(carried('teamsMeetingUrl')).toBe('');
    expect(carried('liveSessionUrl')).toBe('');
    expect(carried('teamsWebLink')).toBe('');
    expect(carried('teamsMeetingOptionsUrl')).toBe('');
    expect(carried('teamsStartDateTimeUtc')).toBe('');
    // The delivery pattern the author set is not a booking, so it stays.
    expect(carried('weekDays')).toBe('Thursday');
    expect(carried('startTime')).toBe('12:00');
    // Nor does the copy claim the row the original was imported from: that is
    // how a training-plan row finds its module, and two modules answering to one
    // row means whichever the scan reaches first wins.
    expect(savedStructure.sourceId).toBe('MOD-COPY');
    expect(savedStructure.sourceId).not.toBe('TRAINING-SOURCE-1');
    expect(savedStructure.sourceType).toBe('module_authoring');
    // And it carries no fingerprint of the original's stored structure.
    expect(String(savedStructure.structureRevision ?? '')).toBe('');
    // The original still owns everything it owned before it was copied.
    expect(source.deliveryMetadata?.teamsLiveSessionId).toBe('LIVE-SOURCE-1');
    expect(source.sourceId).toBe('TRAINING-SOURCE-1');
  });

  it('keeps what the author wrote, which is not the same as what was booked', async () => {
    await duplicateModuleStructure(bookedModule());

    const settings = savedStructure.weekStructure[0].components[0].settings || {};
    expect(settings.sessionPurpose).toBe('Risk foundations, benefits and VUCA');
    expect(settings.sessionTime).toBe('12:00');
    expect(settings.durationMinutes).toBe(120);
    expect(settings.teamsOrganizerEmail).toBe('organiser@example.invalid');
    expect(settings.teamsLobbyBypass).toBe('organizer');
    expect(settings.teamsRecording).toBe('record-transcribe');
  });

  it('gives every row an id of its own, naming the module it now belongs to', async () => {
    const source = bookedModule();
    await duplicateModuleStructure(source);

    const sourceWeekIds = new Set(source.weekStructure.map(week => week.id));
    const sourceComponentIds = new Set(source.weekStructure.flatMap(week => week.components.map(item => item.id)));
    expect(savedStructure.catalogueId).toBe('MOD-COPY');
    expect(savedStructure.catalogueId).not.toBe(source.catalogueId);
    savedStructure.weekStructure.forEach(week => {
      expect(sourceWeekIds.has(week.id)).toBe(false);
      // A week and the components inside it agree on whose module this is.
      expect(week.moduleId).toBe('MOD-COPY');
      week.components.forEach(component => {
        expect(sourceComponentIds.has(component.id)).toBe(false);
        expect(component.moduleId).toBe('MOD-COPY');
        expect(component.weekId).toBe(week.id);
      });
    });
  });

  it('takes the dates of the module drawer it now sits in', async () => {
    await duplicateModuleStructure(bookedModule());

    // This is the step the old copy could never reach: holding the source's
    // date, every component was skipped as "already dated".
    const dated = applyModuleWeekSessionPlan(
      recalculateModule({ ...savedStructure, startDate: '2026-09-18' }),
      fridayPlan(),
    );
    expect(moduleAuthoredLiveSessions(dated).map(session => session.date)).toEqual([
      '2026-09-18',
      '2026-09-25',
    ]);
  });
});
