import { describe, expect, it } from 'vitest';
import {
  applyModuleWeekSessionPlan,
  createEmptyComponent,
  createEmptyWeek,
  createLocalModuleDraft,
  moduleWeekSessionDates,
  moduleWeekIdBySessionNumber,
  moduleUsesSessionRows,
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

function planFor(
  dates: string[],
  skippedBefore: Record<string, string[]> = {},
  slotDates: Record<string, string> = {},
): ModuleWeekSessionPlan {
  return {
    sessions: dates.map((date, index) => ({
      sessionNumber: index + 1,
      date,
      day: 'Saturday',
      slotDate: slotDates[date],
      slotDay: slotDates[date] ? 'Saturday' : undefined,
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
  it('schedules all sixteen imported live sessions without consuming a date for the holiday row', () => {
    const draft = createLocalModuleDraft({ programme: 'Al Fanar', title: 'PCP', description: '', weeks: 1, sessionsNumber: 3, status: 'draft' });
    const weeks = Array.from({ length: 16 }, (_, index) => {
      const week = createEmptyWeek(draft.id, index + 1);
      return { ...week, components: [createEmptyComponent(week.id, 'live-session', 1)] };
    });
    const holiday = createEmptyWeek(draft.id, 3);
    weeks.splice(2, 0, { ...holiday, title: 'Saudi National Day', components: [createEmptyComponent(holiday.id, 'reading', 1)] });
    const module = recalculateModule({ ...draft, weeklySchedule: [
      { day: 'Monday', startTime: '11:00', endTime: '14:00' },
      { day: 'Wednesday', startTime: '11:30', endTime: '14:30' },
    ], weekStructure: weeks });
    expect(module.sessionsNumber).toBe(16);
    expect(moduleUsesSessionRows(module)).toBe(true);
    const dates = ['2026-09-16', '2026-09-21', '2026-10-05', '2026-10-07', '2026-10-12', '2026-10-14', '2026-10-19', '2026-10-21', '2026-10-26', '2026-10-28', '2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11', '2026-11-16', '2026-11-18'];
    const plan = planFor(dates);
    const dated = applyModuleWeekSessionPlan(module, plan);
    expect(dated.weekStructure).toHaveLength(17);
    expect(dated.weekStructure[2].components[0].id).toBe(weeks[2].components[0].id);
    expect(moduleWeekSessionDates(dated, plan.sessions).flat()).toEqual(dates);
    expect(moduleWeekSessionDates(dated, plan.sessions)[2]).toEqual([]);
    expect(moduleWeekIdBySessionNumber(dated, plan.sessions).get(16)).toBe(weeks[16].id);
    expect(dated.weekStructure.flatMap(week => week.components.filter(c => c.type === 'live-session').map(c => c.settings.sessionDate))).toEqual(dates);
  });

  it('gives two live sessions in one week their distinct delivery dates', () => {
    const draft = createLocalModuleDraft({
      programme: 'Split Programme',
      title: 'Monday and Wednesday module',
      description: '',
      weeks: 2,
      sessionsNumber: 4,
      status: 'draft',
      catalogueId: 'MOD-TWICE-WEEKLY',
      startDate: '2026-09-07',
    });
    const module = {
      ...draft,
      weekStructure: draft.weekStructure.map(week => ({
        ...week,
        components: [
          createEmptyComponent(week.id, 'live-session', 1),
          createEmptyComponent(week.id, 'live-session', 2),
        ],
      })),
    };

    const dated = applyModuleWeekSessionPlan(module, planFor([
      '2026-09-07', '2026-09-09', '2026-09-14', '2026-09-16',
    ]));
    const visibleDates = dated.weekStructure.flatMap(week => (
      week.components.map(component => String(component.settings.sessionDate || week.sessionDate || ''))
    ));

    expect(visibleDates).toEqual([
      '2026-09-07', '2026-09-09', '2026-09-14', '2026-09-16',
    ]);
  });

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

  it('shows the week on the delivered replacement date when a holiday moved it', () => {
    const module = sixWeekModule({ weekStructure: [sixWeekModule().weekStructure[0]] });
    const plan = planFor(
      ['2027-01-08'],
      { '2027-01-08': ['2026-12-25', '2027-01-01'] },
      { '2027-01-08': '2026-12-25' },
    );

    const dated = applyModuleWeekSessionPlan(module, plan);

    expect(dated.weekStructure[0].sessionDate).toBe('2027-01-08');
    expect(moduleWeekSessionDates(dated, plan.sessions)[0]).toEqual(['2027-01-08']);
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

/**
 * A plan as the backend now generates it: every delivery day stamped with the
 * Monday-to-Sunday window it falls in, counting the module's own starting week
 * as week 1.
 */
function mondayWeekPlan(
  entries: Array<{ date: string; weekNumber: number; day?: string }>,
): ModuleWeekSessionPlan {
  return {
    sessions: entries.map((entry, index) => ({
      sessionNumber: index + 1,
      weekNumber: entry.weekNumber,
      date: entry.date,
      day: entry.day || 'Monday',
      skippedHolidays: [],
    })),
    skippedHolidays: [],
    finalEndDate: entries[entries.length - 1]?.date || '',
    warnings: [],
  };
}

/** A module of `weekCount` empty weeks, each carrying `liveSessions` of them. */
function weeksCarryingLiveSessions(weekCount: number, liveSessions: number[]): ModuleCatalogueItem {
  const draft = createLocalModuleDraft({
    programme: 'Monday Anchor',
    title: 'Mon+Fri',
    description: '',
    weeks: weekCount,
    status: 'draft',
  });
  return recalculateModule({
    ...draft,
    weeklySchedule: [
      { day: 'Monday', startTime: '09:00', endTime: '11:00' },
      { day: 'Friday', startTime: '09:00', endTime: '11:00' },
    ],
    weekStructure: Array.from({ length: weekCount }, (_, index) => {
      const week = createEmptyWeek(draft.id, index + 1);
      return {
        ...week,
        components: Array.from(
          { length: liveSessions[index] ?? 0 },
          (_unused, offset) => createEmptyComponent(week.id, 'live-session', offset + 1),
        ),
      };
    }),
  });
}

describe('an authored week is a calendar week', () => {
  it('gives a week only the delivery days inside its own Monday-to-Sunday window', () => {
    // Mon+Fri, starting Monday 3 August 2026. Two full weeks, two dates each.
    const module = weeksCarryingLiveSessions(2, [2, 2]);
    const plan = mondayWeekPlan([
      { date: '2026-08-03', weekNumber: 1, day: 'Monday' },
      { date: '2026-08-07', weekNumber: 1, day: 'Friday' },
      { date: '2026-08-10', weekNumber: 2, day: 'Monday' },
      { date: '2026-08-14', weekNumber: 2, day: 'Friday' },
    ]);

    expect(moduleWeekSessionDates(module, plan.sessions)).toEqual([
      ['2026-08-03', '2026-08-07'],
      ['2026-08-10', '2026-08-14'],
    ]);
  });

  it('leaves a mid-week start with a short first week instead of sliding the run', () => {
    // The same Mon+Fri group, but the module starts on Wednesday 5 August. The
    // Monday of that week is before the module began, so week 1 delivers on the
    // Friday alone -- and week 2 still starts on ITS own Monday rather than
    // borrowing the date week 1 never had.
    const module = weeksCarryingLiveSessions(2, [1, 2]);
    const plan = mondayWeekPlan([
      { date: '2026-08-07', weekNumber: 1, day: 'Friday' },
      { date: '2026-08-10', weekNumber: 2, day: 'Monday' },
      { date: '2026-08-14', weekNumber: 2, day: 'Friday' },
    ]);

    expect(moduleWeekSessionDates(module, plan.sessions)).toEqual([
      ['2026-08-07'],
      ['2026-08-10', '2026-08-14'],
    ]);
    // Week 2's first live session runs on week 2's own Monday, not on the
    // Friday that week 1 delivered.
    const dated = applyModuleWeekSessionPlan(module, plan);
    expect(dated.weekStructure[1].components[0].settings.sessionDate).toBe('2026-08-10');
  });

  it('dates a live session added to a week from that week alone', () => {
    // Week 2 gains its second live session. It takes week 2's second delivery
    // day -- never week 3's, and never a date already spoken for.
    const plan = mondayWeekPlan([
      { date: '2026-08-03', weekNumber: 1, day: 'Monday' },
      { date: '2026-08-07', weekNumber: 1, day: 'Friday' },
      { date: '2026-08-10', weekNumber: 2, day: 'Monday' },
      { date: '2026-08-14', weekNumber: 2, day: 'Friday' },
    ]);

    const before = applyModuleWeekSessionPlan(weeksCarryingLiveSessions(2, [2, 1]), plan);
    expect(before.weekStructure[1].components.map(c => c.settings.sessionDate)).toEqual(['2026-08-10']);

    const after = applyModuleWeekSessionPlan(weeksCarryingLiveSessions(2, [2, 2]), plan);
    expect(after.weekStructure[1].components.map(c => c.settings.sessionDate))
      .toEqual(['2026-08-10', '2026-08-14']);
  });

  it('leaves a live session over-authored beyond its week undated', () => {
    // Three live sessions in a week the group delivers twice. There is no third
    // date to give it, and inventing one would put a real Teams meeting on a
    // day nobody chose.
    const plan = mondayWeekPlan([
      { date: '2026-08-03', weekNumber: 1, day: 'Monday' },
      { date: '2026-08-07', weekNumber: 1, day: 'Friday' },
      { date: '2026-08-10', weekNumber: 2, day: 'Monday' },
      { date: '2026-08-14', weekNumber: 2, day: 'Friday' },
    ]);

    const dated = applyModuleWeekSessionPlan(weeksCarryingLiveSessions(2, [3, 2]), plan);

    // The third one keeps the empty date it was created with, which is the
    // "No date" the rail reports and the reason it is not sent to Teams.
    expect(dated.weekStructure[0].components.map(c => c.settings.sessionDate))
      .toEqual(['2026-08-03', '2026-08-07', '']);
    // The extra session did not eat week 2's Monday.
    expect(dated.weekStructure[1].components[0].settings.sessionDate).toBe('2026-08-10');
  });

  it('gives a week the group never delivers in no dates at all', () => {
    // The group pauses for week 2. That week is still a week -- its reading and
    // its assignment stand -- it simply delivers no live session, and week 3
    // keeps its own dates rather than moving up into the gap.
    const module = weeksCarryingLiveSessions(3, [1, 0, 1]);
    const plan = mondayWeekPlan([
      { date: '2026-08-03', weekNumber: 1, day: 'Monday' },
      { date: '2026-08-17', weekNumber: 3, day: 'Monday' },
    ]);

    expect(moduleWeekSessionDates(module, plan.sessions)).toEqual([
      ['2026-08-03'],
      [],
      ['2026-08-17'],
    ]);
    const dated = applyModuleWeekSessionPlan(module, plan);
    expect(dated.weekStructure[2].components[0].settings.sessionDate).toBe('2026-08-17');
  });
});
