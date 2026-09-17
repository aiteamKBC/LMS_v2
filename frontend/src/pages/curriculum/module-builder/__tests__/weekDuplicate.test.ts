import { describe, expect, it } from 'vitest';
import {
  applyModuleWeekSessionPlan,
  createEmptyComponent,
  createLocalModuleDraft,
  duplicateWeekInModule,
  isUnbookedCopiedLiveSession,
  moduleAuthoredLiveSessions,
  recalculateModule,
  type ModuleCatalogueItem,
  type ModuleWeekSessionPlan,
} from '../moduleAuthoringData';

/**
 * Duplicating a week copies the WEEK, not the delivery it is booked for.
 *
 * A week is two different things at once. Most of it is authoring -- the title,
 * the summary, the outcomes, the KSBs and every component's own text, settings,
 * OTJH and points -- and that is exactly what somebody duplicating a week wants
 * back: the shape of a week they have already built, ready to be edited into the
 * next one.
 *
 * The live session comes across too, and everything the author wrote on it comes
 * with it. What does NOT come with it is the booking. `teamsLiveSessionId` is a
 * row in `curriculum.live_sessions`: the original's actual meeting, with its
 * join link, its occurrences, its attendance and its recordings hanging off it.
 * A copy holding it is not a second meeting, it is the same meeting claimed by
 * two weeks -- so the twin's session is planned and unbooked, the rail says so
 * (`isUnbookedCopiedLiveSession`), and creating the meeting is the author's own
 * act.
 */

/** A two-week module whose first week is fully authored and already booked. */
function authoredModule(): ModuleCatalogueItem {
  const draft = createLocalModuleDraft({
    programme: 'Project Controls Professional Level 6',
    title: 'Risk Management',
    description: 'Risk foundations',
    weeks: 2,
    status: 'published',
    catalogueId: 'MOD-SOURCE',
    startDate: '2026-09-18',
  });
  const [first, second] = draft.weekStructure;
  const reading = createEmptyComponent(first.id, 'reading', 1);
  const quiz = createEmptyComponent(first.id, 'quiz', 2);
  const live = createEmptyComponent(first.id, 'live-session', 3);
  return recalculateModule({
    ...draft,
    weekStructure: [
      {
        ...first,
        title: 'Project risk foundations',
        summary: 'Benefits, VUCA and the risk vocabulary',
        learningOutcomes: ['Describe the risk process'],
        sessionDate: '2026-09-18',
        sessionDay: 'Friday',
        ksbMappings: [{ id: 'KSB-WEEK-1', ksbId: 'KSB-K1', code: 'K1', description: 'Risk context', type: 'main', weight: 3, weightClass: 'hard' }],
        components: [
          {
            ...reading,
            title: 'Risk vocabulary handbook',
            description: 'Read before the session',
            expectedOtjh: 1.5,
            points: 20,
            reflectionRequired: true,
            coachValidationRequired: false,
            ksbMappings: [{ id: 'KSB-COMP-1', ksbId: 'KSB-S2', code: 'S2', description: 'Identify risks', type: 'secondary', weight: 1, weightClass: 'soft' }],
            settings: { ...reading.settings, uploadedFileUrl: 'https://example.invalid/handbook' },
          },
          {
            ...quiz,
            title: 'Risk foundations check',
            expectedOtjh: 0.5,
            points: 10,
            // Quizzes are standalone rows carrying learner attempts, so the link
            // is deliberately shared rather than duplicated.
            settings: { ...quiz.settings, linkedQuizId: 'QUIZ-1' },
          },
          {
            ...live,
            title: 'Live session',
            settings: {
              ...live.settings,
              // Authoring: the author's own choices, which a copy keeps.
              sessionPurpose: 'Risk foundations, benefits and VUCA',
              sessionTime: '12:00',
              durationMinutes: 120,
              teamsOrganizerEmail: 'organiser@example.invalid',
              teamsLobbyBypass: 'organizer',
              teamsRecording: 'record-transcribe',
              // Delivery: the day it runs on and the meeting Microsoft made.
              sessionDate: '2026-09-18',
              sessionDay: 'Friday',
              sessionDateTimeUtc: '2026-09-18T11:00:00Z',
              teamsLiveSessionId: 'LIVE-SOURCE-1',
              teamsSessionNumber: 1,
              teamsEventId: 'EVENT-SOURCE-1',
              teamsOnlineMeetingId: 'ONLINE-SOURCE-1',
              teamsMeetingUrl: 'https://teams.microsoft.com/source',
              liveSessionUrl: 'https://teams.microsoft.com/source',
            },
          },
        ],
      },
      { ...second, sessionDate: '2026-09-25', sessionDay: 'Friday' },
    ],
  });
}

/** Three Fridays, as the plan would report them for a three-week run. */
function fridayPlan(): ModuleWeekSessionPlan {
  const dates = ['2026-09-18', '2026-09-25', '2026-10-02'];
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

describe('duplicating a week', () => {
  it('copies every component in full, live session included', () => {
    const source = authoredModule();
    const next = duplicateWeekInModule(source, source.weekStructure[0].id);
    const twin = next.weekStructure[1];

    // The week itself, as it was written.
    expect(twin.title).toBe('Project risk foundations copy');
    expect(twin.summary).toBe('Benefits, VUCA and the risk vocabulary');
    expect(twin.learningOutcomes).toEqual(['Describe the risk process']);
    expect(twin.ksbMappings.map(mapping => mapping.code)).toEqual(['K1']);

    expect(twin.components.map(component => component.type)).toEqual(['reading', 'quiz', 'live-session']);
    const reading = twin.components[0];
    expect(reading.title).toBe('Risk vocabulary handbook');
    expect(reading.description).toBe('Read before the session');
    expect(reading.expectedOtjh).toBe(1.5);
    expect(reading.points).toBe(20);
    expect(reading.reflectionRequired).toBe(true);
    // An author who turned coach validation off does not get it switched back on.
    expect(reading.coachValidationRequired).toBe(false);
    expect(reading.ksbMappings.map(mapping => mapping.code)).toEqual(['S2']);
    expect(reading.settings.uploadedFileUrl).toBe('https://example.invalid/handbook');
    expect(twin.components[1].settings.linkedQuizId).toBe('QUIZ-1');

    // The live session's authoring survives whole: dropping it would only mean
    // typing it again. Only the booking is left behind.
    const live = twin.components[2];
    expect(live.title).toBe('Live session');
    expect(live.settings.sessionPurpose).toBe('Risk foundations, benefits and VUCA');
    expect(live.settings.sessionTime).toBe('12:00');
    expect(live.settings.durationMinutes).toBe(120);
    expect(live.settings.teamsOrganizerEmail).toBe('organiser@example.invalid');
    expect(live.settings.teamsLobbyBypass).toBe('organizer');
    expect(live.settings.teamsRecording).toBe('record-transcribe');
  });

  it('lands directly beneath the week it came from and renumbers the run', () => {
    const source = authoredModule();
    const next = recalculateModule(duplicateWeekInModule(source, source.weekStructure[0].id));

    expect(next.weekStructure).toHaveLength(3);
    expect(next.weekStructure[0].id).toBe(source.weekStructure[0].id);
    expect(next.weekStructure[2].id).toBe(source.weekStructure[1].id);
    expect(next.weekStructure.map(week => week.weekNumber)).toEqual([1, 2, 3]);
    // Week 2's title only ever repeated its own number, so it follows the number
    // down to 3. An authored title is left alone.
    expect(next.weekStructure.map(week => week.title)).toEqual([
      'Project risk foundations',
      'Project risk foundations copy',
      'Week 3',
    ]);
    expect(next.weeks).toBe(3);
  });

  it('gives the twin its own ids and leaves the original untouched', () => {
    const source = authoredModule();
    const sourceWeek = source.weekStructure[0];
    const next = duplicateWeekInModule(source, sourceWeek.id);
    const twin = next.weekStructure[1];

    expect(twin.id).not.toBe(sourceWeek.id);
    expect(twin.moduleId).toBe(sourceWeek.moduleId);
    const sourceComponentIds = new Set(sourceWeek.components.map(component => component.id));
    const sourceKsbIds = new Set(sourceWeek.components.flatMap(component => component.ksbMappings.map(mapping => mapping.id)));
    twin.components.forEach(component => {
      expect(sourceComponentIds.has(component.id)).toBe(false);
      expect(component.weekId).toBe(twin.id);
      // Provenance, not a live link: the same convention `copyComponentToWeek` uses.
      expect(sourceComponentIds.has(String(component.copiedFromId))).toBe(true);
      component.ksbMappings.forEach(mapping => expect(sourceKsbIds.has(mapping.id)).toBe(false));
    });

    // Editing the twin's settings must not reach into the week it came from.
    twin.components[0].settings.uploadedFileUrl = 'https://example.invalid/changed';
    expect(sourceWeek.components[0].settings.uploadedFileUrl).toBe('https://example.invalid/handbook');
    expect(sourceWeek.components.map(component => component.type)).toEqual(['reading', 'quiz', 'live-session']);
    expect(sourceWeek.title).toBe('Project risk foundations');
  });

  it('copies the live session without the meeting behind it', () => {
    const source = authoredModule();
    const next = recalculateModule(duplicateWeekInModule(source, source.weekStructure[0].id));
    const twin = next.weekStructure[1];

    // Undated, so the module's own plan is free to date it.
    expect(twin.sessionDate).toBe('');
    expect(twin.sessionDay).toBe('');
    // Dropped keys come back as the component type's own empty default, so
    // "carries nothing" is an empty value here rather than an absent one.
    twin.components.forEach(component => {
      const settings = component.settings || {};
      const carried = (key: string) => String(settings[key] ?? '');
      expect(carried('sessionDate')).toBe('');
      expect(carried('sessionDay')).toBe('');
      expect(carried('sessionDateTimeUtc')).toBe('');
      // Nothing the twin does can reach the original's meeting, because it
      // holds no pointer to one.
      expect(carried('teamsLiveSessionId')).toBe('');
      expect(carried('teamsSessionNumber')).toBe('');
      expect(carried('teamsEventId')).toBe('');
      expect(carried('teamsOnlineMeetingId')).toBe('');
      expect(carried('teamsMeetingUrl')).toBe('');
      expect(carried('liveSessionUrl')).toBe('');
    });

    // And the original's own booking is untouched by having been copied.
    expect(source.weekStructure[0].components[2].settings.teamsLiveSessionId).toBe('LIVE-SOURCE-1');
    expect(source.weekStructure[0].components[2].settings.teamsMeetingUrl).toBe('https://teams.microsoft.com/source');
  });

  it('flags the copied live session as unbooked until a meeting exists', () => {
    const source = authoredModule();
    const next = duplicateWeekInModule(source, source.weekStructure[0].id);
    const twin = next.weekStructure[1];

    // This is what the Course structure note is printed from.
    expect(twin.components.filter(isUnbookedCopiedLiveSession)).toHaveLength(1);
    // Only the live session -- a copied reading has no meeting to be missing.
    expect(twin.components.filter(isUnbookedCopiedLiveSession)[0].type).toBe('live-session');
    // The original was never a copy, so it is never flagged.
    expect(source.weekStructure[0].components.filter(isUnbookedCopiedLiveSession)).toHaveLength(0);

    // The note stops being true the moment the week's own meeting is created.
    const booked = {
      ...twin.components[2],
      settings: { ...twin.components[2].settings, teamsLiveSessionId: 'LIVE-COPY-1', teamsMeetingUrl: 'https://teams.microsoft.com/copy' },
    };
    expect(isUnbookedCopiedLiveSession(booked)).toBe(false);
  });

  it('takes its date from the module plan, leaving the booked original where it is', () => {
    const source = authoredModule();
    const next = recalculateModule(duplicateWeekInModule(source, source.weekStructure[0].id));

    const dated = applyModuleWeekSessionPlan(next, fridayPlan());
    const sessions = moduleAuthoredLiveSessions(dated);
    // Two sessions now: the original's, and the twin's own. Week 3 authored none.
    expect(sessions.map(session => session.date)).toEqual(['2026-09-18', '2026-09-25']);
    // The original is booked at Microsoft, so the plan leaves its date alone.
    expect(dated.weekStructure[0].components[2].settings.sessionDate).toBe('2026-09-18');
    expect(dated.weekStructure[0].components[2].settings.teamsLiveSessionId).toBe('LIVE-SOURCE-1');
    // The twin is dated from its own place in the run, not from the source's.
    expect(dated.weekStructure[1].components[2].settings.sessionDate).toBe('2026-09-25');
    expect(String(dated.weekStructure[1].components[2].settings.teamsLiveSessionId ?? '')).toBe('');
  });

  it('leaves the module alone when the week id is not one of its own', () => {
    const source = authoredModule();
    expect(duplicateWeekInModule(source, 'WEEK-NOT-HERE')).toBe(source);
  });
});
