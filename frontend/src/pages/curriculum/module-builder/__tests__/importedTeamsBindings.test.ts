import { describe, expect, it } from 'vitest';
import { normaliseComponentSettings } from '../componentAuthoringModel';
import {
  applyModuleWeekSessionPlan,
  createEmptyComponent,
  createLocalModuleDraft,
  independentCopySettings,
  type ModuleWeekSessionPlan,
} from '../moduleAuthoringData';

const decemberPlan: ModuleWeekSessionPlan = {
  sessions: [{ sessionNumber: 1, weekNumber: 1, date: '2026-12-25', day: 'Friday', startTime: '12:00', endTime: '14:00', skippedHolidays: [] }],
  skippedHolidays: [], finalEndDate: '2026-12-31', warnings: [],
};

function moduleWithImportedSession(binding: string) {
  const module = createLocalModuleDraft({
    programme: 'Example programme', title: 'Imported calendar', description: '',
    catalogueId: 'MOD-IMPORTED', weeks: 1, status: 'draft', startDate: '2026-12-18',
  });
  const week = module.weekStructure[0];
  const component = createEmptyComponent(week.id, 'live-session', 1);
  week.components = [{
    ...component,
    settings: {
      ...component.settings,
      sessionDate: '2026-12-18', sessionTime: '12:00', durationMinutes: 120,
      sessionTimeZone: 'Europe/London', teamsMeetingType: 'linked-external',
      teamsCalendarBinding: binding, liveSessionUrl: 'https://example.invalid/existing-meeting',
      teamsStartDateTimeUtc: '',
    },
  }];
  return module;
}

describe('imported Teams delivery settings', () => {
  it('retains a pending calendar date through the builder save representation', () => {
    const settings = normaliseComponentSettings('live-session', {
      sessionDate: '2026-12-25',
      teamsCalendarBinding: 'missing',
      teamsMainLinkInherited: true,
      liveSessionUrl: 'https://example.invalid/existing-meeting',
    });
    expect(settings.teamsCalendarBinding).toBe('missing');
    expect(settings.teamsMainLinkInherited).toBe(true);
    expect(normaliseComponentSettings('live-session', settings).teamsCalendarBinding).toBe('missing');
  });

  it('recovers the binding status saved by an older builder as legacy settings', () => {
    const settings = normaliseComponentSettings('live-session', {
      legacySettings: JSON.stringify({ teamsCalendarBinding: 'matched', teamsMainLinkInherited: false }),
    });
    expect(settings.teamsCalendarBinding).toBe('matched');
    expect(settings.teamsMainLinkInherited).toBe(false);
  });

  it('does not give an independent copy the original calendar confirmation', () => {
    const settings = independentCopySettings({
      sessionPurpose: 'Preserve authored content',
      teamsCalendarBinding: 'matched',
      teamsMainLinkInherited: true,
      teamsOccurrenceId: 'ORIGINAL-OCCURRENCE',
    });
    expect(settings.sessionPurpose).toBe('Preserve authored content');
    expect(settings).not.toHaveProperty('teamsCalendarBinding');
    expect(settings).not.toHaveProperty('teamsMainLinkInherited');
    expect(settings).not.toHaveProperty('teamsOccurrenceId');
  });

  it.each(['missing', 'ambiguous'])('keeps a %s imported date unconfirmed when its week moves', binding => {
    const applied = applyModuleWeekSessionPlan(moduleWithImportedSession(binding), decemberPlan);
    expect(applied.weekStructure[0].components[0].settings).toMatchObject({
      sessionDate: '2026-12-25', sessionDateTimeUtc: '2026-12-25T12:00:00.000Z',
      teamsStartDateTimeUtc: '', teamsCalendarBinding: binding,
      liveSessionUrl: 'https://example.invalid/existing-meeting',
    });
    expect(applyModuleWeekSessionPlan(applied, decemberPlan)).toBe(applied);
  });

  it('clears a stale confirmation timestamp even when the planned date already matches', () => {
    const applied = applyModuleWeekSessionPlan(moduleWithImportedSession('missing'), decemberPlan);
    applied.weekStructure[0].components[0].settings.teamsStartDateTimeUtc = '2026-12-25T12:00:00.000Z';
    const repaired = applyModuleWeekSessionPlan(applied, decemberPlan);
    expect(repaired.weekStructure[0].components[0].settings.teamsStartDateTimeUtc).toBe('');
    expect(repaired.weekStructure[0].components[0].settings.sessionDateTimeUtc).toBe('2026-12-25T12:00:00.000Z');
  });

  it('retains a confirmed occurrence until the server matches the new imported plan', () => {
    const module = moduleWithImportedSession('matched');
    Object.assign(module.weekStructure[0].components[0].settings, {
      teamsLiveSessionId: 'IMPORTED-SERIES', teamsSessionNumber: 1,
      teamsOccurrenceId: 'EXISTING-OCCURRENCE', teamsStartDateTimeUtc: '2026-12-18T12:00:00Z',
    });
    const applied = applyModuleWeekSessionPlan(module, decemberPlan);
    expect(applied.weekStructure[0].components[0].settings).toMatchObject({
      sessionDate: '2026-12-18', teamsOccurrenceId: 'EXISTING-OCCURRENCE',
      teamsStartDateTimeUtc: '2026-12-18T12:00:00Z', teamsCalendarBinding: 'matched',
    });
  });

  it('keeps an additional meeting on its own date when an inserted week moves its main delivery slot', () => {
    const module = moduleWithImportedSession('');
    const settings = module.weekStructure[0].components[0].settings;
    Object.assign(settings, {
      teamsMeetingScope: 'additional',
      extraTeamsMeetingUrl: 'https://example.invalid/guest-masterclass',
      liveSessionUrl: 'https://example.invalid/guest-masterclass',
      extraTeamsStartDateTimeUtc: '2026-12-18T15:00:00Z',
      sessionDate: '2026-12-18', sessionTime: '15:00', durationMinutes: 60,
      sessionDateTimeUtc: '2026-12-18T15:00:00Z',
    });
    const applied = applyModuleWeekSessionPlan(module, {
      ...decemberPlan,
      sessions: decemberPlan.sessions.map(session => ({ ...session, rescheduled: true })),
    });
    expect(applied.weekStructure[0].sessionDate).toBe('2026-12-25');
    expect(applied.weekStructure[0].components[0].settings).toBe(settings);
    expect(settings).toMatchObject({
      sessionDate: '2026-12-18', sessionTime: '15:00', durationMinutes: 60,
      extraTeamsStartDateTimeUtc: '2026-12-18T15:00:00Z',
      liveSessionUrl: 'https://example.invalid/guest-masterclass',
    });
  });
});
