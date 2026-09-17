import { describe, expect, it } from 'vitest';
import { applyModuleWeekSessionPlan, moduleLiveSessionDateDrift } from '../moduleAuthoringData';

// A live session runs on the day its week runs on. The date stored on the
// component is a copy of the plan's, not a second opinion, so it follows the
// plan whenever the plan moves -- a changed start date, a week dragged up the
// rail, a week inserted ahead of it. Holding the first-stamped date instead let
// a week headed 09 Oct contain a session dated 30 Oct, and the session's date is
// the one the calendar and Teams use.
//
// The single exception is an occurrence Microsoft has confirmed: real people
// were invited to that date, and it moves by asking Microsoft, never locally.

/** A module with `weeks` Mon-Sun weeks, each holding the live sessions given. */
function moduleWith(weeks: { id: string; sessions: { id: string; settings?: Record<string, unknown> }[] }[]) {
  return {
    catalogueId: 'MOD-DRIFT',
    title: 'Drift',
    weeks: weeks.length,
    weekStructure: weeks.map((week, index) => ({
      id: week.id,
      moduleId: 'MOD-DRIFT',
      weekNumber: index + 1,
      title: `Week ${index + 1}`,
      summary: '',
      learningOutcomes: [],
      ksbMappings: [],
      components: week.sessions.map(session => ({
        id: session.id,
        title: session.id,
        type: 'live-session',
        settings: session.settings || {},
      })),
    })),
  } as never;
}

/** One planned date per entry, stamped with the Mon-Sun week it falls in. */
function planOf(...sessions: [number, string][]) {
  return {
    sessions: sessions.map(([weekNumber, date], index) => ({
      sessionNumber: index + 1, weekNumber, date, day: '', skippedHolidays: [],
    })),
    skippedHolidays: [], finalEndDate: '', warnings: [],
  } as never;
}

/** The settings of the one live session in the first week. */
function settingsOf(module: unknown): Record<string, unknown> {
  return (module as { weekStructure: { components: { settings: Record<string, unknown> }[] }[] })
    .weekStructure[0].components[0].settings;
}

describe('applyModuleWeekSessionPlan re-dates a live session with its week', () => {
  it('moves a session left on the date it was first stamped with', () => {
    // The module used to start three weeks later, so this session was stamped
    // 30 Oct. The start date moved back; the week follows the plan, and now so
    // does the session.
    const applied = applyModuleWeekSessionPlan(
      moduleWith([{ id: 'WEEK-1', sessions: [{ id: 'COMP-1', settings: { sessionDate: '2026-10-30', sessionTime: '09:00' } }] }]),
      planOf([1, '2026-10-09']),
    );
    expect(settingsOf(applied).sessionDate).toBe('2026-10-09');
    // The learner timeline and the programme calendar read the instant, so a
    // stale one would still point at the old day after the date had moved.
    expect(settingsOf(applied).sessionDateTimeUtc).toBe('2026-10-09T08:00:00.000Z');
  });

  it('keeps the clock and length the author set, and moves only the day', () => {
    const applied = applyModuleWeekSessionPlan(
      moduleWith([{ id: 'WEEK-1', sessions: [{ id: 'COMP-1', settings: { sessionDate: '2026-10-30', sessionTime: '19:00', durationMinutes: 45 } }] }]),
      planOf([1, '2026-10-09']),
    );
    expect(settingsOf(applied)).toMatchObject({ sessionDate: '2026-10-09', sessionTime: '19:00', durationMinutes: 45 });
  });

  it('will not move a meeting Microsoft has confirmed', () => {
    // Real attendees hold an invitation to this date. It changes by asking
    // Microsoft, not by a planner rewriting it underneath them.
    const applied = applyModuleWeekSessionPlan(
      moduleWith([{ id: 'WEEK-1', sessions: [{ id: 'COMP-BOOKED', settings: {
        sessionDate: '2026-10-30', sessionTime: '09:00', teamsLiveSessionId: 'LIVE-1', teamsSessionNumber: 1,
      } }] }]),
      planOf([1, '2026-10-09']),
    );
    expect(settingsOf(applied).sessionDate).toBe('2026-10-30');
  });

  it('is not fooled by the sessionDateTimeUtc it writes itself', () => {
    // The planner stamps this instant on every date it sets, so treating it as
    // proof of a Teams booking froze every date the planner had ever written --
    // which is exactly how the stale dates survived.
    const applied = applyModuleWeekSessionPlan(
      moduleWith([{ id: 'WEEK-1', sessions: [{ id: 'COMP-1', settings: {
        sessionDate: '2026-10-30', sessionTime: '09:00', sessionDateTimeUtc: '2026-10-30T09:00:00.000Z',
      } }] }]),
      planOf([1, '2026-10-09']),
    );
    expect(settingsOf(applied).sessionDate).toBe('2026-10-09');
  });

  it('leaves a module alone when it already agrees with the plan', () => {
    // Opening a module must not mark it edited. The same object comes back, or
    // the builder shows "unsaved changes" on a module nobody has touched — and
    // re-dating on every load would do exactly that if it were not checked.
    // The instant is spelled the way the BACKEND spells it (Python's `+00:00`),
    // because that is what actually arrives. Comparing these as strings marked
    // every module in the system as edited the moment it was opened.
    const module = moduleWith([{ id: 'WEEK-1', sessions: [{ id: 'COMP-1', settings: {
      sessionDate: '2026-10-09', sessionDay: '', sessionTime: '09:00', sessionDateTimeUtc: '2026-10-09T08:00:00+00:00',
      teamsStartDateTimeUtc: '2026-10-09T08:00:00+00:00',
    } }] }]);
    // The week carries what the backend stamps on it when it serves the
    // structure, so this is a module as freshly loaded, not a half-built one.
    (module as unknown as { weekStructure: Record<string, unknown>[] }).weekStructure[0].sessionDate = '2026-10-09';
    (module as unknown as { weekStructure: Record<string, unknown>[] }).weekStructure[0].sessionDay = '';
    (module as unknown as { endDate: string }).endDate = '2026-10-09';
    expect(applyModuleWeekSessionPlan(module, planOf([1, '2026-10-09']))).toBe(module);
  });

  it('gives each live session of a two-day week its own planned date', () => {
    // A Mon+Fri week owns two dates, taken in course order. Collapsing them onto
    // the week's first date would put both meetings on the Monday.
    const applied = applyModuleWeekSessionPlan(
      moduleWith([{ id: 'WEEK-1', sessions: [
        { id: 'COMP-MON', settings: { sessionDate: '2026-09-28', sessionTime: '09:00' } },
        { id: 'COMP-FRI', settings: { sessionDate: '2026-10-02', sessionTime: '09:00' } },
      ] }]),
      planOf([1, '2026-10-05'], [1, '2026-10-09']),
    );
    const week = (applied as unknown as { weekStructure: { components: { settings: { sessionDate: string } }[] }[] }).weekStructure[0];
    expect(week.components.map(component => component.settings.sessionDate)).toEqual(['2026-10-05', '2026-10-09']);
  });
});

describe('moduleLiveSessionDateDrift reports only what the planner could not move', () => {
  it('names a confirmed Teams booking whose week has moved on', () => {
    const drift = moduleLiveSessionDateDrift(
      moduleWith([{ id: 'WEEK-1', sessions: [{ id: 'COMP-BOOKED', settings: {
        sessionDate: '2026-10-30', teamsLiveSessionId: 'LIVE-1', teamsSessionNumber: 1,
      } }] }]),
      planOf([1, '2026-10-09']),
    );
    expect(drift.get('COMP-BOOKED')).toMatchObject({
      componentId: 'COMP-BOOKED', weekId: 'WEEK-1', storedDate: '2026-10-30', weekDates: ['2026-10-09'],
    });
  });

  it('says nothing about a session the planner is free to move', () => {
    // No booking, so it will be re-dated rather than reported. Warning about it
    // as well would put a permanent amber mark on a date that is about to fix
    // itself.
    const drift = moduleLiveSessionDateDrift(
      moduleWith([{ id: 'WEEK-1', sessions: [{ id: 'COMP-1', settings: { sessionDate: '2026-10-30' } }] }]),
      planOf([1, '2026-10-09']),
    );
    expect(drift.size).toBe(0);
  });

  it('leaves a booking alone when it sits on any of its week s delivery days', () => {
    // A Mon+Fri week owns two dates. A meeting on the Friday is exactly where it
    // belongs -- comparing against the week's first date alone would have called
    // every second session in the module misplaced.
    const drift = moduleLiveSessionDateDrift(
      moduleWith([{ id: 'WEEK-1', sessions: [
        { id: 'COMP-MON', settings: { sessionDate: '2026-10-05', teamsLiveSessionId: 'LIVE-1', teamsSessionNumber: 1 } },
        { id: 'COMP-FRI', settings: { sessionDate: '2026-10-09', teamsLiveSessionId: 'LIVE-1', teamsSessionNumber: 2 } },
      ] }]),
      planOf([1, '2026-10-05'], [1, '2026-10-09']),
    );
    expect(drift.size).toBe(0);
  });

  it('claims nothing at all without a plan to compare against', () => {
    // No plan is an unknown, not a disagreement. A screen whose plan has not
    // loaded, or failed to, must not start accusing dates of being wrong.
    const module = moduleWith([{ id: 'WEEK-1', sessions: [{ id: 'COMP-1', settings: {
      sessionDate: '2026-10-30', teamsLiveSessionId: 'LIVE-1', teamsSessionNumber: 1,
    } }] }]);
    expect(moduleLiveSessionDateDrift(module, null).size).toBe(0);
    expect(moduleLiveSessionDateDrift(module, { sessions: [] } as never).size).toBe(0);
  });
});
