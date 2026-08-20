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
  groupsForScope,
  matchesSearch,
  modulesForScope,
  resolveGroupContext,
  resolveModuleContext,
  sameFormValues,
  scheduleLabel,
} from '../model';

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
