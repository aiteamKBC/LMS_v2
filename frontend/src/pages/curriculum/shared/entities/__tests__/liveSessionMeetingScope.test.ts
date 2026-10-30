import { describe, expect, it } from 'vitest';
import { bookedOnModuleSeries, liveSessionMeetingScope, liveSessionPlan, meetingScopeIsOpen, moduleHasBookedSeries } from '../liveSessionMeetingScope';

describe('liveSessionMeetingScope', () => {
  it('reads a booking before any stored choice', () => {
    expect(liveSessionMeetingScope({ extraTeamsMeetingUrl: 'https://x.invalid', teamsMeetingScope: 'main' })).toBe('additional');
    expect(liveSessionMeetingScope({ teamsOccurrenceId: 'OCC-1', teamsMeetingScope: 'additional' })).toBe('main');
    expect(liveSessionMeetingScope({ teamsSessionNumber: 3 })).toBe('main');
    expect(moduleHasBookedSeries([{ settings: { teamsOccurrenceId: 'OCC-1', teamsMeetingScope: 'additional' } }])).toBe(true);
  });

  it('treats a saved normal meeting link as an assigned module calendar', () => {
    expect(liveSessionMeetingScope({ liveSessionUrl: 'https://teams.example/normal' }, true)).toBe('main');
    expect(liveSessionMeetingScope({ teamsMeetingUrl: 'https://teams.example/normal' }, true)).toBe('main');
    expect(liveSessionMeetingScope({ liveSessionUrl: 'https://teams.example/additional', teamsMeetingScope: 'additional' }, true)).toBe('additional');
  });

  it('reads the stored choice when nothing is booked', () => {
    expect(liveSessionMeetingScope({ teamsMeetingScope: 'main' })).toBe('main');
    expect(liveSessionMeetingScope({ teamsMeetingScope: 'additional' })).toBe('additional');
  });

  it('leaves an unassigned week pending once the module calendar exists, and gives it to the module before', () => {
    expect(liveSessionMeetingScope({}, true)).toBe('pending');
    expect(liveSessionMeetingScope({}, false)).toBe('main');
    expect(liveSessionMeetingScope(undefined, false)).toBe('main');
  });

  it('uses pasted main links as an established calendar without claiming a confirmed booking', () => {
    const settings = { liveSessionUrl: 'https://teams.example/normal' };
    expect(moduleHasBookedSeries([{ settings }])).toBe(true);
    expect(bookedOnModuleSeries(settings)).toBe(false);
    expect(liveSessionMeetingScope({ liveSessionUrl: 'https://teams.example/normal' }, true)).toBe('main');
    expect(moduleHasBookedSeries([{ settings: {
      liveSessionUrl: 'https://teams.example/additional',
      extraTeamsMeetingUrl: 'https://teams.example/additional',
      teamsMeetingScope: 'additional',
    } }])).toBe(false);
    expect(moduleHasBookedSeries([{ settings: {
      liveSessionLinkOverride: 'https://teams.example/additional', teamsMeetingScope: 'additional',
    } }])).toBe(false);
  });

  it('asks an inserted blank week to choose its calendar when only pasted links exist', () => {
    const pasted = { liveSessionLinkOverride: 'https://teams.example/existing' };
    const hasCalendar = moduleHasBookedSeries([{ settings: pasted }, { settings: {} }]);
    expect(liveSessionMeetingScope(pasted, hasCalendar)).toBe('main');
    expect(liveSessionMeetingScope({}, hasCalendar)).toBe('pending');
    expect(meetingScopeIsOpen({})).toBe(true);
  });

  it('keeps the choice open only while neither calendar has booked the week', () => {
    expect(meetingScopeIsOpen({ teamsMeetingScope: 'main' })).toBe(true);
    expect(meetingScopeIsOpen({ teamsOccurrenceId: 'OCC-1' })).toBe(false);
    expect(meetingScopeIsOpen({ extraTeamsMeetingUrl: 'https://x.invalid' })).toBe(false);
    expect(meetingScopeIsOpen({ liveSessionUrl: 'https://teams.example/normal' })).toBe(true);
    expect(meetingScopeIsOpen({ liveSessionUrl: 'https://teams.example/additional', teamsMeetingScope: 'additional' })).toBe(true);
  });
});

describe('liveSessionPlan', () => {
  const live = (settings: Record<string, unknown>) => ({ id: String(Math.random()), type: 'live-session', title: '', settings });
  const plan = (weeks: number[]) => ({
    sessions: weeks.map(weekNumber => ({ sessionNumber: weekNumber, weekNumber, date: `2026-12-${String(weekNumber).padStart(2, '0')}`, day: '', skippedHolidays: [] })),
    skippedHolidays: [], finalEndDate: '', warnings: [],
  });

  it('sends every week of a module with no calendar yet, except one reserved for an additional meeting', () => {
    const module = { weekStructure: [
      { weekNumber: 1, components: [live({})] },
      { weekNumber: 2, components: [live({ teamsMeetingScope: 'additional' })] },
      { weekNumber: 3, components: [live({})] },
    ] };
    expect(liveSessionPlan(module as never, plan([1, 2, 3])).map(item => item.weekNumber)).toEqual([1, 3]);
  });

  it('drops a week added after the calendar exists until it is given to the module calendar', () => {
    const module = { weekStructure: [
      { weekNumber: 1, components: [live({ teamsOccurrenceId: 'OCC-1' })] },
      { weekNumber: 2, components: [live({})] },
      { weekNumber: 3, components: [live({ teamsMeetingScope: 'main' })] },
    ] };
    expect(liveSessionPlan(module as never, plan([1, 2, 3])).map(item => item.weekNumber)).toEqual([1, 3]);
  });

  it('does not silently assign an inserted week to a pasted main meeting link', () => {
    const module = { weekStructure: [
      { weekNumber: 1, components: [live({ liveSessionUrl: 'https://teams.example/existing' })] },
      { weekNumber: 2, components: [live({})] },
      { weekNumber: 3, components: [live({ liveSessionUrl: 'https://teams.example/existing' })] },
    ] };
    expect(liveSessionPlan(module as never, plan([1, 2, 3])).map(item => item.weekNumber)).toEqual([1, 3]);
  });

  it('keeps the later main session after an additional meeting in the middle', () => {
    const module = { weekStructure: [
      { weekNumber: 1, components: [live({ teamsOccurrenceId: 'OCC-1', teamsSessionNumber: 1 })] },
      { weekNumber: 2, components: [live({
        extraTeamsMeetingUrl: 'https://teams.example.invalid/event',
        teamsMeetingScope: 'additional',
      })] },
      { weekNumber: 3, components: [live({ teamsOccurrenceId: 'OCC-3', teamsSessionNumber: 3 })] },
    ] };
    const selected = liveSessionPlan(module as never, plan([1, 2, 3]));
    expect(selected.map(item => item.weekNumber)).toEqual([1, 3]);
    expect(selected.map(item => item.sessionNumber)).toEqual([1, 3]);
  });

  it('sends each date once when the module starts after its opening week s delivery day', () => {
    // Starts on a Sunday, delivers Wednesdays: the plan's dates sit in calendar
    // weeks 2-6, so week 1 has none of its own and falls back to the first date.
    // Week 2 matching that same date by calendar week sent two sessions on one
    // day and dropped the last.
    const booked = (n: number) => live({ teamsOccurrenceId: `OCC-${n}`, teamsSessionNumber: n });
    const module = { weekStructure: [1, 2, 3, 4, 5].map(n => ({ weekNumber: n, components: [booked(n)] })) };
    const selected = liveSessionPlan(module as never, plan([2, 3, 4, 5, 6]));
    expect(selected.map(item => item.date)).toEqual(['2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06']);
    expect(selected.map(item => item.sessionNumber)).toEqual([1, 2, 3, 4, 5]);
  });
});
