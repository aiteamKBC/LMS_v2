import { describe, expect, it } from 'vitest';
import { createEmptyComponent } from '../../week-builder/weekTemplateData';
import { createLocalModuleDraft, moduleStructureDelta, recalculateModule, type ModuleWeekSessionPlan } from '../moduleAuthoringData';
import { liveSessionCalendarMovePending, moveComponentToWeek } from '../componentWeekMove';

function fixture() {
  const draft = createLocalModuleDraft({ programme: 'QA Programme', title: 'QA Module', description: '', weeks: 3, status: 'draft', catalogueId: 'QA-MODULE' });
  const component = {
    ...createEmptyComponent('W1', 'reading', 1), id: 'C1', sourceId: 'STORED-C1', title: 'Stored reading',
    expectedOtjh: 2.5, points: 17, reflectionRequired: true, coachValidationRequired: true,
    ksbMappings: [{ id: 'MAP-1', ksbId: 'KSB-1', code: 'K1', type: 'main' as const, description: 'Knowledge', weight: 40, weightClass: 'hard' as const }],
    settings: { readingContent: '<p>Stored chapter</p>', uploadedFileUrl: '/curriculum_api/curriculum/uploads/qa.pdf', contentStatus: 'Approved' },
  };
  return recalculateModule({ ...draft, weekStructure: draft.weekStructure.map((week, index) => ({
    ...week, id: `W${index + 1}`, sessionDate: ['2026-10-20', '2026-10-27', '2026-11-03'][index],
    components: index === 0 ? [component] : index === 1 ? [{ ...createEmptyComponent('W2', 'quiz', 1), id: 'C2' }] : [],
  })) });
}

describe('component moves between module weeks', () => {
  it('reparents the same saved component once, preserving content, mappings, assurance, files and totals', () => {
    const module = fixture(), before = JSON.stringify(module), component = module.weekStructure[0].components[0];
    const moved = moveComponentToWeek(module, component.id, 'W2').module;
    expect(moved.weekStructure[2]).toBe(module.weekStructure[2]);
    expect(moved.weekStructure[1].components[1]).toEqual({ ...component, weekId: 'W2' });
    const result = recalculateModule(moved);
    expect(result.weekStructure[0].components).toEqual([]);
    expect(result.weekStructure[1].components.map(item => item.id)).toEqual(['C2', 'C1']);
    expect(result.weekStructure[1].components[1].settings.readingContent).toBe(component.settings.readingContent);
    expect(result.weekStructure[1].components[1].ksbMappings).toEqual(component.ksbMappings);
    expect(result.weekStructure[2]).toEqual(module.weekStructure[2]);
    expect(result.totalOtjh).toBe(module.totalOtjh);
    expect(result.weekStructure.flatMap(week => week.components)).toHaveLength(2);
    expect(JSON.stringify(module)).toBe(before);
    const delta = moduleStructureDelta(module, result);
    expect(delta.componentOrder).toEqual({ W1: [], W2: ['C2', 'C1'], W3: [] });
    expect(Object.keys(delta.components)).toEqual(['C1']);
    expect(delta.components.C1).toEqual(result.weekStructure[1].components[1]);
    expect(delta.components.C1).toMatchObject({ id: component.id, sourceId: component.sourceId, weekId: 'W2' });
  });

  it('moves to an empty week and rejects missing, current or stale destinations without changing the source', () => {
    const module = fixture(), before = JSON.stringify(module);
    expect(moveComponentToWeek(module, 'C1', 'W3').module.weekStructure[2].components[0].id).toBe('C1');
    expect(() => moveComponentToWeek(module, 'C1', 'W1')).toThrow('different week');
    expect(() => moveComponentToWeek(module, 'C1', 'MISSING')).toThrow('no longer in this module');
    expect(() => moveComponentToWeek(module, 'MISSING', 'W2')).toThrow('no longer in this module');
    expect(JSON.stringify(module)).toBe(before);
  });

  it('keeps unselected source siblings and their order when moving from a filtered rail', () => {
    const module = fixture();
    const hidden = { ...createEmptyComponent('W1', 'video', 2), id: 'HIDDEN-VIDEO', title: 'Unfiltered video' };
    module.weekStructure[0].components.push(hidden);
    const moved = moveComponentToWeek(module, 'C1', 'W2').module;
    expect(moved.weekStructure[0].components).toEqual([hidden]);
    expect(moved.weekStructure[0].components[0]).toBe(hidden);
    expect(moved.weekStructure[1].components.map(component => component.id)).toEqual(['C2', 'C1']);
  });

  function liveFixture(booked = false) {
    const module = fixture();
    module.weekStructure[0].components[0] = {
      ...module.weekStructure[0].components[0], type: 'live-session', settings: {
        sessionDate: '2026-10-20', sessionDay: 'Tuesday', sessionTime: '09:00', sessionTimeZone: 'Europe/London',
        sessionDateTimeUtc: '2026-10-20T08:00:00Z', teamsStartDateTimeUtc: '2026-10-20T08:00:00Z', durationMinutes: 60,
        sessionPurpose: 'Stored outline', liveSessionUrl: 'https://teams.example.test/qa',
        ...(booked ? { teamsLiveSessionId: 'LIVE-1', teamsSessionNumber: 1, teamsEventId: 'EVENT-1', teamsOccurrenceId: 'OCC-1' } : {}),
      },
    };
    return module;
  }

  it('dates an unbooked live session from the destination plan across the London DST boundary', () => {
    const module = liveFixture();
    const plan = { sessions: [
      { sessionNumber: 1, date: '2026-10-20', day: 'Tuesday' },
      { sessionNumber: 2, date: '2026-10-28', day: 'Wednesday' },
      { sessionNumber: 3, date: '2026-11-03', day: 'Tuesday' },
    ] } as ModuleWeekSessionPlan;
    const result = moveComponentToWeek(module, 'C1', 'W2', plan);
    expect(result.sessionDate).toBe('2026-10-28');
    expect(result.module.weekStructure[1].components[1].settings).toMatchObject({
      sessionDate: '2026-10-28', sessionDay: 'Wednesday', sessionTime: '09:00',
      sessionDateTimeUtc: '2026-10-28T09:00:00.000Z', teamsStartDateTimeUtc: '2026-10-28T09:00:00.000Z', sessionPurpose: 'Stored outline', durationMinutes: 60,
    });
    expect(result.calendarPending).toBe(false);
  });

  it('changes the planned date of a booked session while keeping its meeting identity and actual calendar instant', () => {
    const module = liveFixture(true), original = module.weekStructure[0].components[0];
    const result = moveComponentToWeek(module, 'C1', 'W2');
    const moved = result.module.weekStructure[1].components[1];
    expect(moved.settings).toMatchObject({ ...original.settings, sessionDate: '2026-10-27', sessionDateTimeUtc: '2026-10-27T09:00:00.000Z' });
    expect(moved.id).toBe(original.id);
    expect(result.calendarPending).toBe(true);
    expect(liveSessionCalendarMovePending({ ...moved, settings: { ...moved.settings, teamsStartDateTimeUtc: moved.settings.sessionDateTimeUtc } })).toBe(false);
  });

  it('understands a stored Microsoft time-zone name without changing the booking', () => {
    const module = liveFixture(true);
    module.weekStructure[0].components[0].settings.sessionTimeZone = 'GMT Standard Time';
    const moved = moveComponentToWeek(module, 'C1', 'W2');
    expect(moved.module.weekStructure[1].components[1].settings.sessionDateTimeUtc).toBe('2026-10-27T09:00:00.000Z');
    expect(moved.calendarPending).toBe(true);
  });

  it('keeps an additional meeting distinct and leaves an imported unmatched session unconfirmed', () => {
    const module = liveFixture();
    const component = module.weekStructure[0].components[0];
    component.settings = { ...component.settings, extraTeamsMeetingUrl: 'https://teams.example.test/additional', extraTeamsLiveSessionId: 'EXTRA-1', extraTeamsStartDateTimeUtc: '2026-10-20T08:00:00Z' };
    const moved = moveComponentToWeek(module, 'C1', 'W2');
    expect(moved.calendarPending).toBe(true);
    expect(moved.module.weekStructure[1].components[1].settings.extraTeamsLiveSessionId).toBe('EXTRA-1');
    component.settings = { sessionTime: '09:00', sessionTimeZone: 'Europe/London', teamsCalendarBinding: 'missing' };
    expect(moveComponentToWeek(module, 'C1', 'W2').module.weekStructure[1].components[1].settings.teamsStartDateTimeUtc).toBe('');
  });

  it('refuses to invent a live session date for an undated destination', () => {
    const module = liveFixture(); module.weekStructure[1].sessionDate = '';
    expect(() => moveComponentToWeek(module, 'C1', 'W2')).toThrow('no delivery date');
    expect(module.weekStructure[0].components).toHaveLength(1);
  });
});
