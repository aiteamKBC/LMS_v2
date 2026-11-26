import { describe, expect, it } from 'vitest';
import type {
  CurriculumCohort,
  CurriculumGroup,
  CurriculumModule,
  CurriculumProgramme,
} from '@/lib/curriculumApi';
import {
  cohortsForProgramme,
  cohortYear,
  findByIdentifierThenName,
  findCohort,
  findGroup,
  findProgramme,
  groupsForScope,
  holidaysForScheduling,
  matchesSearch,
  moduleCohortDateError,
  moduleSoftStartDate,
  modulesForScope,
  namedCurriculumWorkspacePath,
  resolveGroupContext,
  resolveModuleContext,
  sameFormValues,
  scheduleLabel,
  visibleNotes,
} from '../model';

/**
 * Names are not unique in this data: the same module title is authored in two
 * programmes, two cohorts are both called "October 2026". Whenever an identifier
 * could be either an id or a name, every id has to be tried before any name --
 * otherwise the answer is decided by list order, which is a sort concern.
 */
describe('resolving a record by identifier before name', () => {
  it('prefers the id match even when a namesake is listed first', () => {
    const items = [
      { id: 'B', name: 'A' },
      { id: 'A', name: 'Second' },
    ];
    expect(findByIdentifierThenName(items, 'A', item => [item.id], item => [item.name]))
      .toEqual({ id: 'A', name: 'Second' });
  });

  it('still falls back to the name when no id matches at all', () => {
    const items = [{ id: 'B', name: 'A' }];
    expect(findByIdentifierThenName(items, 'A', item => [item.id], item => [item.name]))
      .toEqual({ id: 'B', name: 'A' });
  });

  it('answers undefined for a blank identifier rather than the first record', () => {
    const items = [{ id: 'B', name: '' }];
    expect(findByIdentifierThenName(items, '  ', item => [item.id], item => [item.name])).toBeUndefined();
  });

  it('does not let a blank field match a blank candidate', () => {
    const items = [{ id: '', name: '' }, { id: 'REAL', name: 'Real' }];
    expect(findByIdentifierThenName(items, 'REAL', item => [item.id], item => [item.name]))
      .toEqual({ id: 'REAL', name: 'Real' });
  });

  it('resolves a programme by id past a namesake, and by name when no id matches', () => {
    const programmes = [
      { id: 'p1', sourceId: 'PROG-B', name: 'PROG-A' },
      { id: 'p2', sourceId: 'PROG-A', name: 'Marketing Executive Level 4' },
    ] as CurriculumProgramme[];
    expect(findProgramme(programmes, 'PROG-A')?.sourceId).toBe('PROG-A');
    expect(findProgramme(programmes, 'Marketing Executive Level 4')?.sourceId).toBe('PROG-A');
  });

  it('resolves a cohort and a group by id past a namesake', () => {
    const cohorts = [
      { id: 'COHORT-2', name: 'COHORT-1' },
      { id: 'COHORT-1', name: 'October 2026' },
    ] as CurriculumCohort[];
    expect(findCohort(cohorts, 'COHORT-1')?.name).toBe('October 2026');

    const groups = [
      { id: 'GROUP-2', name: 'GROUP-1' },
      { id: 'GROUP-1', name: 'G1' },
    ] as CurriculumGroup[];
    expect(findGroup(groups, 'GROUP-1')?.name).toBe('G1');
  });
});

describe('named curriculum workspace paths', () => {
  it('keeps the canonical id and carries the group name for immediate rendering', () => {
    expect(namedCurriculumWorkspacePath('groups', 'GROUP-1', 'Group A'))
      .toBe('/curriculum/groups/GROUP-1?groupName=Group+A');
  });

  it('keeps the canonical id and carries the module name for immediate rendering', () => {
    expect(namedCurriculumWorkspacePath('modules', 'MOD-1', 'Data Foundations'))
      .toBe('/curriculum/modules/MOD-1?moduleName=Data+Foundations');
  });
});

// The entity pages must never invent a Module -> Cohort relationship: a module's
// programme and cohort are read through its group. These fixtures make that
// visible by giving the module's own cached fields the WRONG parents, so any
// helper that trusts them instead of the group fails loudly.
const programmes = [
  { id: 'program-data', sourceId: 'PROG-DATA', name: 'Data Analyst' },
  { id: 'program-net', sourceId: 'PROG-NET', name: 'Network Engineer' },
] as CurriculumProgramme[];

const cohorts = [
  { id: 'COHORT-1', name: 'Sept 2026', programmeId: 'PROG-DATA', programme: 'Data Analyst', startDate: '2026-09-01' },
  { id: 'COHORT-2', name: 'Jan 2027', programmeId: 'PROG-NET', programme: 'Network Engineer', startDate: '2027-01-05' },
] as CurriculumCohort[];

const groups = [
  { id: 'GROUP-1', name: 'Group A', cohortId: 'COHORT-1', cohort: 'Sept 2026', programme: 'Data Analyst', weekDays: 'Wednesday', startTime: '10:00', endTime: '12:00' },
  { id: 'GROUP-2', name: 'Group B', cohortId: 'COHORT-2', cohort: 'Jan 2027', programme: 'Network Engineer' },
] as CurriculumGroup[];

const modules = [
  {
    id: 'MOD-1',
    moduleCatalogueId: 'MOD-1',
    name: 'Data Foundations',
    groupId: 'GROUP-1',
    // Deliberately stale/wrong denormalised parents.
    cohortId: 'COHORT-2',
    cohort: 'Jan 2027',
    programmeId: 'PROG-NET',
    programme: 'Network Engineer',
  },
  {
    id: 'MOD-ORPHAN',
    moduleCatalogueId: 'MOD-ORPHAN',
    name: 'Unattached module',
    groupId: '',
    cohortId: 'COHORT-2',
    cohort: 'Jan 2027',
    programmeId: 'PROG-NET',
    programme: 'Network Engineer',
  },
] as CurriculumModule[];

describe('module parent resolution', () => {
  it('derives programme and cohort through the group, not from the module', () => {
    const context = resolveModuleContext(modules[0], groups, cohorts, programmes);

    expect(context.groupId).toBe('GROUP-1');
    expect(context.cohortId).toBe('COHORT-1');
    expect(context.cohortName).toBe('Sept 2026');
    expect(context.programmeId).toBe('PROG-DATA');
    expect(context.programmeName).toBe('Data Analyst');
    expect(context.linked).toBe(true);
  });

  it('falls back to the module\'s own fields when it has no group, and says so', () => {
    const context = resolveModuleContext(modules[1], groups, cohorts, programmes);

    expect(context.groupId).toBe('');
    expect(context.cohortId).toBe('COHORT-2');
    expect(context.programmeId).toBe('PROG-NET');
    expect(context.linked).toBe(false);
  });

  it('resolves a group\'s programme through its cohort', () => {
    const context = resolveGroupContext(groups[0], cohorts, programmes);

    expect(context.cohortId).toBe('COHORT-1');
    expect(context.programmeId).toBe('PROG-DATA');
    expect(context.linked).toBe(true);
  });

  it('reports an unlinked group rather than guessing a cohort', () => {
    const orphan = { id: 'GROUP-X', name: 'Orphan', cohortId: 'COHORT-GONE', cohort: 'Removed', programme: 'Data Analyst' } as CurriculumGroup;
    const context = resolveGroupContext(orphan, cohorts, programmes);

    expect(context.linked).toBe(false);
    expect(context.cohortId).toBe('COHORT-GONE');
    // The programme still resolves from the group's own name so the row is not blank.
    expect(context.programmeName).toBe('Data Analyst');
  });
});

describe('cascades', () => {
  it('scopes cohorts to a programme by id or name', () => {
    expect(cohortsForProgramme(cohorts, programmes, 'PROG-DATA').map(c => c.id)).toEqual(['COHORT-1']);
    expect(cohortsForProgramme(cohorts, programmes, 'Data Analyst').map(c => c.id)).toEqual(['COHORT-1']);
  });

  it('returns every cohort when no programme is chosen', () => {
    expect(cohortsForProgramme(cohorts, programmes, '')).toHaveLength(2);
  });

  it('scopes groups by cohort, and by programme when no cohort is chosen', () => {
    expect(groupsForScope(groups, cohorts, programmes, { cohortId: 'COHORT-2' }).map(g => g.id)).toEqual(['GROUP-2']);
    expect(groupsForScope(groups, cohorts, programmes, { programmeId: 'PROG-DATA' }).map(g => g.id)).toEqual(['GROUP-1']);
    expect(groupsForScope(groups, cohorts, programmes, {})).toHaveLength(2);
  });

  it('scopes modules through their group, ignoring stale module-level parents', () => {
    // MOD-1 claims PROG-NET but its group belongs to PROG-DATA.
    expect(modulesForScope(modules, groups, cohorts, programmes, { programmeId: 'PROG-DATA' }).map(m => m.id))
      .toEqual(['MOD-1']);
    expect(modulesForScope(modules, groups, cohorts, programmes, { groupId: 'GROUP-1' }).map(m => m.id))
      .toEqual(['MOD-1']);
  });

  it('keeps a group-less module findable under its cached cohort', () => {
    expect(modulesForScope(modules, groups, cohorts, programmes, { cohortId: 'COHORT-2' }).map(m => m.id))
      .toEqual(['MOD-ORPHAN']);
  });

  it('returns every module when nothing is scoped', () => {
    expect(modulesForScope(modules, groups, cohorts, programmes, {})).toHaveLength(2);
  });
});

describe('a module has to fit inside its cohort', () => {
  // The practical end date is the boundary; the apprenticeship end that follows
  // it is the EPA window and carries no delivery.
  const cohort = {
    id: 'COHORT-1',
    startDate: '2026-09-01',
    endDate: '2027-08-31',
    practicalEndDate: '2027-08-31',
    apprenticeshipEndDate: '2027-11-30',
  } as CurriculumCohort;

  it('accepts a module inside the window', () => {
    expect(moduleCohortDateError(cohort, '2026-09-02', '2027-08-25')).toBeNull();
    // The boundaries themselves are inside it.
    expect(moduleCohortDateError(cohort, '2026-09-01', '2027-08-31')).toBeNull();
    // Soft start can begin one calendar month before the cohort opens.
    expect(moduleCohortDateError(cohort, '2026-08-01', '2026-10-01')).toBeNull();
  });

  it('refuses a start date before the soft-start month', () => {
    expect(moduleSoftStartDate(cohort.startDate)).toBe('2026-08-01');
    expect(moduleCohortDateError(cohort, '2026-07-31', '2026-10-01')).toMatch(/more than one month/);
  });

  it('refuses a start date after the cohort has finished', () => {
    expect(moduleCohortDateError(cohort, '2027-09-01', '')).toMatch(/cannot start after/);
  });

  it('refuses an end date past the cohort end, even when the start date fits', () => {
    // The case the start-date bound alone misses: the generated session plan
    // runs on past the cohort.
    expect(moduleCohortDateError(cohort, '2027-08-25', '2027-09-15')).toMatch(/cannot finish after/);
  });

  it('stays quiet until there is a cohort and a date to judge', () => {
    expect(moduleCohortDateError(undefined, '2026-09-02', '2027-08-25')).toBeNull();
    expect(moduleCohortDateError(cohort, '', '')).toBeNull();
  });

  it('reads the EPA period as outside the delivery window', () => {
    expect(moduleCohortDateError(cohort, '2026-09-02', '2027-10-01')).toMatch(/cannot finish after/);
  });
});

describe('presentation helpers', () => {
  it('matches every search term across the given fields', () => {
    expect(matchesSearch('data found', ['Data Foundations', 'Group A'])).toBe(true);
    expect(matchesSearch('data missing', ['Data Foundations', 'Group A'])).toBe(false);
    expect(matchesSearch('   ', ['anything'])).toBe(true);
  });

  it('reads a cohort year off its start date', () => {
    expect(cohortYear(cohorts[0])).toBe('2026');
    expect(cohortYear({ ...cohorts[0], startDate: '' })).toBe('');
  });

  it('builds a delivery schedule label from the stored parts', () => {
    expect(scheduleLabel(groups[0])).toBe('Wednesday · 10:00–12:00');
    expect(scheduleLabel({ schedule: 'Fridays' } as CurriculumGroup)).toBe('Fridays');
    expect(scheduleLabel({} as CurriculumGroup)).toBe('—');
  });
});

describe('unsaved-form comparison', () => {
  it('reads a changed answer as a change', () => {
    expect(sameFormValues({ name: '', epaMonths: '' }, { name: '', epaMonths: '' })).toBe(true);
    expect(sameFormValues({ name: 'Sept 2026', epaMonths: '' }, { name: '', epaMonths: '' })).toBe(false);
    expect(sameFormValues({ holidayIds: ['1'] }, { holidayIds: [] })).toBe(false);
    expect(sameFormValues({ holidayIds: ['1', '2'] }, { holidayIds: ['1', '2'] })).toBe(true);
  });

  it('does not read an empty answer as a change however it is spelled', () => {
    expect(sameFormValues({ epaMonths: null }, { epaMonths: '' })).toBe(true);
    expect(sameFormValues({ epaMonths: undefined }, {})).toBe(true);
    // Key order is an implementation detail of whichever snapshot was built first.
    expect(sameFormValues({ name: 'A', level: '4' }, { level: '4', name: 'A' })).toBe(true);
  });
});

// Every module the API returns has its parent chain appended to `notes` as
// hidden `__key:value` lines. They are derived from real columns on each read,
// so a reader must never see them and a form must never save them back.
describe('notes the reader is meant to see', () => {
  const stored = [
    'Bring the reporting template.',
    '__program_id:PROG-DATA',
    '__cohort_id:COHORT-1',
    '__module_catalogue_id:MOD-3',
  ].join('\n');

  it('keeps the written note and drops the bookkeeping lines', () => {
    expect(visibleNotes(stored)).toBe('Bring the reporting template.');
  });

  it('reads notes that are nothing but bookkeeping as empty', () => {
    expect(visibleNotes('__program_id:PROG-DATA\n__group_name:Group A')).toBe('');
    expect(visibleNotes(undefined)).toBe('');
    expect(visibleNotes('   __group_id:GROUP-1  ', 'No notes')).toBe('No notes');
  });

  it('only drops a line that starts with the marker', () => {
    expect(visibleNotes('Use the __init__ helper.')).toBe('Use the __init__ helper.');
  });
});


describe('the bank holidays a module has to step over', () => {
  // England's bank holidays, in the shape `/curriculum/holidays/` serves them:
  // one day each, so start and end are the same date.
  const HOLIDAYS = [
    { id: 'england-and-wales:2026-08-31', startDate: '2026-08-31', endDate: '2026-08-31' },
    { id: 'england-and-wales:2026-12-25', startDate: '2026-12-25', endDate: '2026-12-25' },
    { id: 'england-and-wales:2027-03-29', startDate: '2027-03-29', endDate: '2027-03-29' },
  ];

  it('starts at the cohort start date, because nothing delivers before it', () => {
    expect(holidaysForScheduling(HOLIDAYS, '2026-12-01').map(holiday => holiday.startDate))
      .toEqual(['2026-12-25', '2027-03-29']);
  });

  it('keeps a holiday falling exactly on the start date', () => {
    expect(holidaysForScheduling(HOLIDAYS, '2026-08-31').map(holiday => holiday.startDate))
      .toEqual(['2026-08-31', '2026-12-25', '2027-03-29']);
  });

  it('has no end bound, so a plan that overshoots its cohort still skips', () => {
    // A cohort ending 2027-03-25 still carries Easter Monday for scheduling:
    // every holiday a plan steps over pushes it a slot later, so the sessions
    // that land past the cohort end must keep stepping over the ones they meet.
    expect(holidaysForScheduling(HOLIDAYS, '2026-12-01').map(holiday => holiday.startDate))
      .toContain('2027-03-29');
  });

  it('gives an undated cohort the whole calendar rather than none of it', () => {
    // A session must never be planned onto a bank holiday, and an imported
    // cohort missing its dates is not a reason to schedule one on Christmas Day.
    expect(holidaysForScheduling(HOLIDAYS, '')).toEqual(HOLIDAYS);
    expect(holidaysForScheduling(HOLIDAYS, undefined)).toEqual(HOLIDAYS);
  });
});
