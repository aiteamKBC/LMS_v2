import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyModuleWeekSessionPlan,
  createEmptyComponent,
  createLocalModuleDraft,
  loadModuleWeekSessionPlan,
  weeksTouchedByHoliday,
  type ModuleWeekSessionPlan,
} from '../moduleAuthoringData';

const holiday = { label: 'Synthetic closure', startDate: '2026-11-25', endDate: '2026-11-25' };
const plan: ModuleWeekSessionPlan = {
  sessions: [{ sessionNumber: 1, weekNumber: 1, date: '2026-11-19', day: 'Thursday', skippedHolidays: [] }],
  weeks: [{ weekNumber: 1, startDate: '2026-11-16', endDate: '2026-11-22', holidays: [], holidayWeek: false },
    { weekNumber: 2, startDate: '2026-11-23', endDate: '2026-11-29', holidays: [holiday], holidayWeek: true }],
  skippedHolidays: [], finalEndDate: '2026-11-19', warnings: [],
};

function moduleDraft() {
  const draft = createLocalModuleDraft({ catalogueId: 'MOD-CONTRACT', title: 'Synthetic module',
    programme: 'Synthetic programme', description: '', weeks: 2, status: 'draft', endDate: '2026-11-29' });
  draft.weekBoundaryMode = 'calendar';
  draft.weekStructure[1].studyWeekHolidays = [holiday];
  const booked = createEmptyComponent(draft.weekStructure[0].id, 'live-session', 1);
  booked.settings = { ...booked.settings, teamsLiveSessionId: 'SYNTHETIC-SERIES', teamsSessionNumber: 1,
    teamsEventId: 'SYNTHETIC-EVENT', liveSessionUrl: 'https://example.invalid/meeting', sessionDate: '2026-11-12' };
  draft.weekStructure[0].components = [booked];
  return draft;
}

afterEach(() => vi.unstubAllGlobals());

describe('module session-plan response contract', () => {
  it.each([2, null, undefined, { count: 2 }])('opens a calendar module when weeks is %j instead of an array', async weeks => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...plan, weeks }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })));
    const loaded = await loadModuleWeekSessionPlan('MOD-CONTRACT', 2);
    const draft = moduleDraft();
    const before = structuredClone(draft);
    const result = applyModuleWeekSessionPlan(draft, loaded!);
    expect(result.weekStructure[0].sessionDate).toBe('2026-11-19');
    expect(result.weekStructure[0].components).toEqual(before.weekStructure[0].components);
    expect(result.weekStructure[1].studyWeekHolidays).toEqual([holiday]);
    expect(result.endDate).toBe(before.endDate);
    expect(weeksTouchedByHoliday(result, loaded).get(draft.weekStructure[1].id)?.[0].holidays).toEqual([holiday]);
    expect(draft).toEqual(before);
  });

  it('retains array week windows and holidays even when all live sessions are paused', () => {
    const draft = moduleDraft();
    const paused = { ...plan, sessions: [] };
    const result = applyModuleWeekSessionPlan(draft, paused);
    expect(result.weekStructure[1]).toMatchObject({ studyWeekStartDate: '2026-11-23',
      studyWeekEndDate: '2026-11-29', studyWeekHolidays: [holiday] });
    expect(weeksTouchedByHoliday(result, paused).get(draft.weekStructure[1].id)?.[0].date).toBe('2026-11-23');
    expect(result.weekStructure[0].components).toEqual(draft.weekStructure[0].components);
  });

  it('leaves the module unchanged when a numeric count has no session dates', () => {
    const draft = moduleDraft();
    const empty = { ...plan, sessions: [], weeks: 2 } as unknown as ModuleWeekSessionPlan;
    expect(applyModuleWeekSessionPlan(draft, empty)).toBe(draft);
    expect(weeksTouchedByHoliday(draft, empty).size).toBe(1);
  });
});
