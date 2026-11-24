import { describe, expect, it } from 'vitest';
import { applyModuleWeekSessionPlan, createEmptyComponent, createLocalModuleDraft, moduleTeamsPlannedSessions, moduleWeekPlanOffset, moduleWeekSessionSlots, type ModuleWeekSessionPlan } from '../moduleAuthoringData';

const dates = ['2026-12-09', '2026-12-16', '2026-12-23', '2026-12-30', '2027-01-06'];
const sessions: ModuleWeekSessionPlan['sessions'] = dates.map((date, index) => ({ date, weekNumber: index + 1, sessionNumber: index + 1, day: 'Wednesday', skippedHolidays: [] }));

function moduleWithGeneralMaterials() {
  const draft = createLocalModuleDraft({ programme: 'Programme', title: 'General materials and reading weeks', description: '', weeks: 6, status: 'draft', endDate: '2027-01-06' });
  return { ...draft, sessionsNumber: 5, weekStructure: draft.weekStructure.map((week, index) => {
    if (![1, 2, 5].includes(index)) return { ...week, components: [createEmptyComponent(week.id, 'reading', 1)] };
    const live = createEmptyComponent(week.id, 'live-session', 1);
    live.settings = { ...live.settings, sessionDate: dates[index - 1], teamsLiveSessionId: 'SERIES', teamsSessionNumber: index };
    return { ...week, components: [live] };
  }) };
}

describe('general materials before the delivery plan', () => {
  it('uses the confirmed meeting date for its heading when numbering excludes other weeks', () => {
    const module = moduleWithGeneralMaterials();
    const live = module.weekStructure[1].components[0];
    live.settings = { ...live.settings, sessionDate: '2026-12-16', teamsSessionNumber: 1,
      teamsOccurrenceId: 'OCC-CONFIRMED', liveSessionUrl: 'https://example.invalid/confirmed' };
    const original = structuredClone(module.weekStructure[1].components);
    const result = applyModuleWeekSessionPlan(module, { sessions, skippedHolidays: [], warnings: [], finalEndDate: '' });
    expect(result.weekStructure[1].sessionDate).toBe('2026-12-16');
    expect(result.weekStructure[1].sessionDay).toBe('Wednesday');
    expect(result.weekStructure[1].components).toEqual(original);
  });

  it('does not use an unverified booking or an additional meeting as the confirmed main heading', () => {
    const module = moduleWithGeneralMaterials();
    const live = module.weekStructure[1].components[0];
    live.settings = { ...live.settings, sessionDate: '2026-12-16', teamsSessionNumber: 1,
      teamsCalendarBinding: 'unverified' };
    const extra = structuredClone(live);
    extra.id = 'EXTRA';
    extra.settings = { ...extra.settings, sessionDate: '2026-12-30', extraTeamsMeetingUrl: 'https://example.invalid/extra' };
    module.weekStructure[1].components.unshift(extra);
    const result = applyModuleWeekSessionPlan(module, { sessions, skippedHolidays: [], warnings: [], finalEndDate: '' });
    expect(result.weekStructure[1].sessionDate).toBe('2026-12-09');
    expect(result.weekStructure[1].components[0]).toEqual(extra);
  });
  it.each([2, 3, 4])('keeps every link and recording with its own session for %i lives per week', count => {
    const draft = createLocalModuleDraft({ programme: 'Programme', title: 'Multiple live sessions', description: '', weeks: 4, status: 'draft', endDate: '2027-03-21' });
    const plan: ModuleWeekSessionPlan['sessions'] = [];
    const weeks = draft.weekStructure.map(week => ({ ...week, components: [createEmptyComponent(week.id, 'reading', 1)] }));
    for (let week = 0; week < 3; week += 1) {
      for (let position = 0; position < count; position += 1) {
        const date = `2027-03-${String(1 + week * 7 + position).padStart(2, '0')}`;
        plan.push({ date, weekNumber: week + 1, sessionNumber: plan.length + 1, day: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'][position], skippedHolidays: week === 1 ? [date] : [] });
        if (week === 1) continue;
        const component = createEmptyComponent(weeks[week + 1].id, 'live-session', position + 1);
        component.settings = { ...component.settings, sessionDate: date,
          teamsLiveSessionId: 'SERIES', teamsSessionNumber: week * count + position + 1,
          teamsOccurrenceId: `OCC-${week}-${position}`, liveSessionUrl: `https://example.invalid/live/${week}/${position}`,
          recordingUrl: `https://example.invalid/recording/${week}/${position}` };
        weeks[week + 1].components.push(component);
      }
    }
    const module = { ...draft, sessionsNumber: count * 3, weekStructure: weeks };
    const original = structuredClone(weeks.map(week => week.components));
    const result = applyModuleWeekSessionPlan(module, { sessions: plan, skippedHolidays: [], warnings: [], finalEndDate: plan[plan.length - 1]?.date || '' });
    expect(moduleWeekSessionSlots(module, plan)).toEqual([0, count, count, count]);
    expect(result.weekStructure.map(week => week.components)).toEqual(original);
    const planned = moduleTeamsPlannedSessions(result, { sessions: plan, skippedHolidays: [], warnings: [], finalEndDate: '' });
    expect(planned).toHaveLength(count * 2);
    expect(planned.map(session => session.date)).toEqual(plan.filter(session => session.weekNumber !== 2).map(session => session.date));
    expect(result.endDate).toBe('2027-03-21');
  });
  it('aligns headers without shifting booked dates or creating Live in reading weeks', () => {
    const module = moduleWithGeneralMaterials();
    const original = module.weekStructure.map(week => structuredClone(week.components));
    expect(moduleWeekPlanOffset(module, sessions)).toBe(1);
    expect(moduleWeekSessionSlots(module, sessions)).toEqual([0, 1, 1, 1, 1, 1]);
    const result = applyModuleWeekSessionPlan(module, { sessions, skippedHolidays: [], finalEndDate: dates[4], warnings: [] });
    expect(result.weekStructure.map(week => week.sessionDate)).toEqual([undefined, ...dates]);
    expect(result.weekStructure.map(week => week.components)).toEqual(original);
    expect(result.endDate).toBe(module.endDate);
  });

  it('requires consistent booked dates and never guesses from a Week 00 title', () => {
    const module = moduleWithGeneralMaterials();
    module.weekStructure[5].components[0].settings.sessionDate = dates[3];
    expect(moduleWeekPlanOffset(module, sessions)).toBe(0);
    module.weekStructure[5].components[0].settings.sessionDate = '2027-02-01';
    expect(moduleWeekPlanOffset(module, sessions)).toBe(0);
  });

  it('keeps a genuine first holiday week in place and leaves explicit calendar weeks unchanged', () => {
    const module = moduleWithGeneralMaterials();
    expect(moduleWeekPlanOffset(module, sessions.map(session => ({ ...session, weekNumber: Number(session.weekNumber) + 1 })))).toBe(0);
    expect(moduleWeekPlanOffset({ ...module, weekBoundaryMode: 'calendar' }, sessions)).toBe(0);
  });
});
