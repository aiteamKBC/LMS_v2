import { describe, expect, it } from 'vitest';
import {
  applyModuleWeekSessionPlan,
  createEmptyWeek,
  createLocalModuleDraft,
  recalculateModule,
  resequenceWeekSessionDates,
  type ModuleCatalogueItem,
  type ModuleWeekSessionPlan,
} from '../moduleAuthoringData';

/**
 * Week N is session N of the module's own dated plan, so a week added in the
 * builder has to be given the next planned date — the next delivery day the
 * cohort has not closed for a holiday — and the module has to end up knowing it
 * runs a session more than it used to.
 *
 * The dates below are the ones the backend generates for a Saturday module that
 * starts on 12 December 2026 with Christmas closed, which is the module this was
 * reported against.
 */
const SATURDAY_DATES = [
  '2026-12-12', '2027-01-02', '2027-01-09', '2027-01-16',
  '2027-01-23', '2027-01-30', '2027-02-06',
];

function planFor(dates: string[], skippedBefore: Record<string, string[]> = {}): ModuleWeekSessionPlan {
  return {
    sessions: dates.map((date, index) => ({
      sessionNumber: index + 1,
      date,
      day: 'Saturday',
      skippedHolidays: skippedBefore[date] || [],
    })),
    skippedHolidays: Object.values(skippedBefore).flat(),
    finalEndDate: dates[dates.length - 1] || '',
    warnings: [],
  };
}

/** A six-week Saturday module, dated exactly as the structure payload serves it. */
function sixWeekModule(overrides: Partial<ModuleCatalogueItem> = {}): ModuleCatalogueItem {
  const draft = createLocalModuleDraft({
    programme: 'MSN',
    title: 'Fouda-ss',
    description: '',
    weeks: 6,
    status: 'draft',
    catalogueId: 'MOD-WEEKS',
    startDate: '2026-12-08',
    endDate: '2027-01-30',
  });
  return recalculateModule({
    ...draft,
    weekStructure: draft.weekStructure.map((week, index) => ({
      ...week,
      sessionDate: SATURDAY_DATES[index],
      sessionDay: 'Saturday',
    })),
    ...overrides,
  });
}

/** The same module with a seventh week added, as the Add week button adds one. */
function withSeventhWeek(module: ModuleCatalogueItem) {
  return recalculateModule({
    ...module,
    weekStructure: [...module.weekStructure, createEmptyWeek(module.id, module.weekStructure.length + 1)],
  });
}

describe('dating a week added in the builder', () => {
  it('gives the added week the next planned date and leaves the others put', () => {
    const added = withSeventhWeek(sixWeekModule());

    // Before the plan is read back the new week has no date at all — which is
    // the bug this exists to close.
    expect(added.weekStructure[6].sessionDate).toBeUndefined();

    const dated = applyModuleWeekSessionPlan(added, planFor(SATURDAY_DATES));

    expect(dated.weekStructure.map(week => week.sessionDate)).toEqual(SATURDAY_DATES);
    expect(dated.weekStructure[6].sessionDay).toBe('Saturday');
  });

  it('takes the date the plan moved off a holiday, not the closed day', () => {
    // The fourteenth Saturday of this module falls inside a closed Easter, so
    // the week that reaches it runs the Saturday after.
    const dates = [...SATURDAY_DATES.slice(0, 6), '2027-04-03'];
    const dated = applyModuleWeekSessionPlan(
      withSeventhWeek(sixWeekModule()),
      planFor(dates, { '2027-04-03': ['2027-03-27'] }),
    );

    expect(dated.weekStructure[6].sessionDate).toBe('2027-04-03');
  });

  it('moves the end date out when it was the plan’s own last session', () => {
    const dated = applyModuleWeekSessionPlan(withSeventhWeek(sixWeekModule()), planFor(SATURDAY_DATES));

    // 30 January was the last of six sessions; seven sessions finish a week later.
    expect(dated.endDate).toBe('2027-02-06');
  });

  it('leaves an end date that was set by hand exactly where it was put', () => {
    const module = withSeventhWeek(sixWeekModule({ endDate: '2027-06-30' }));

    const dated = applyModuleWeekSessionPlan(module, planFor(SATURDAY_DATES));

    expect(dated.endDate).toBe('2027-06-30');
    expect(dated.weekStructure[6].sessionDate).toBe('2027-02-06');
  });

  it('leaves the end date alone when it is only dating a module on sight', () => {
    // Opening a module is not an edit to when it finishes, so the dates are
    // applied and the end date is not.
    const module = withSeventhWeek(sixWeekModule());

    const dated = applyModuleWeekSessionPlan(module, planFor(SATURDAY_DATES), { followEndDate: false });

    expect(dated.weekStructure[6].sessionDate).toBe('2027-02-06');
    expect(dated.endDate).toBe('2027-01-30');
  });

  it('changes nothing when the weeks already run to the plan', () => {
    // Applied on every open, so a plan the module already agrees with must not
    // come back as an edit waiting to be saved.
    const module = sixWeekModule();

    expect(applyModuleWeekSessionPlan(module, planFor(SATURDAY_DATES.slice(0, 6)))).toBe(module);
  });

  it('reports the week count from the weeks that exist', () => {
    // The module form reopens on this number: a module whose weeks went from six
    // to seven has to offer seven, or the next save puts the sixth week back.
    expect(sixWeekModule().weeks).toBe(6);
    expect(withSeventhWeek(sixWeekModule()).weeks).toBe(7);
  });

  it('leaves the calendar session count alone when a week is added', () => {
    // Sessions are not weeks: a group delivering twice a week runs two sessions
    // per authored week, so re-deriving this from the structure would halve the
    // session plan and the Teams series.
    const module = { ...sixWeekModule(), sessionsNumber: 12 };

    expect(withSeventhWeek(module).sessionsNumber).toBe(12);
  });
});

describe('reordering the weeks of a dated module', () => {
  it('leaves the timetable where it is and moves only what is taught', () => {
    const weeks = sixWeekModule().weekStructure;
    const moved = [weeks[3], ...weeks.slice(0, 3), ...weeks.slice(4)];

    const resequenced = resequenceWeekSessionDates(moved);

    expect(resequenced.map(week => week.sessionDate)).toEqual(SATURDAY_DATES.slice(0, 6));
    // The week that was dragged to the top now runs on the first session date.
    expect(resequenced[0].id).toBe(weeks[3].id);
  });

  it('keeps undated weeks at the end of the run', () => {
    const module = withSeventhWeek(sixWeekModule());
    const moved = [module.weekStructure[6], ...module.weekStructure.slice(0, 6)];

    const resequenced = resequenceWeekSessionDates(moved);

    expect(resequenced.slice(0, 6).map(week => week.sessionDate)).toEqual(SATURDAY_DATES.slice(0, 6));
    expect(resequenced[6].sessionDate).toBeUndefined();
  });
});
