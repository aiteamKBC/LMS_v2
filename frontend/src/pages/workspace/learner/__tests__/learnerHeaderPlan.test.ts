import { describe, expect, it } from 'vitest';
import type { PlanModule } from '@/api/trainingPlanDashboard';
import { learnerHeaderPlan, learnerModuleHref } from '../learnerHeaderPlan';

const placement = { programme: 'Marketing Level 4', cohort: 'October 2026', group: 'G1' };
const module = (id: string, start_date: string | null, end_date: string | null, overrides: Partial<PlanModule> = {}): PlanModule => ({
  id, title: id, start_date, end_date, programme_name: placement.programme, cohort_name: placement.cohort,
  group_name: placement.group, description: '', tutor_name: '', coach_name: 'Assigned coach', ...overrides,
});
const next = module('Marketing Impact and Planning', '2026-10-05', '2027-02-11');
const future = module('Social Media', '2027-02-15', '2027-05-20');
const oldPlacement = module('Aya Modual', '2026-08-03', '2026-10-23', { cohort_name: 'Final Cohort', group_name: 'Aya Group' });

describe('learner header programme facts', () => {
  it('continues the current week for either a Builder module or its linked imported subject', () => {
    expect(learnerModuleHref('commercial', '125', 'M1'))
      .toBe('/learner/my-learning/commercial/125?subject=current%3AM1&week=current');
    expect(learnerModuleHref('apprenticeship', '126', 'M1', { 'legacy:77': { id: 'M1', title: 'Module' } }))
      .toBe('/learner/my-learning/apprenticeship/126?subject=legacy%3A77&week=current');
    expect(learnerModuleHref('commercial', '125'))
      .toBe('/learner/my-learning/commercial/125?week=current');
  });
  it('uses the next teaching date in the current placement instead of the last-created module', () => {
    expect(learnerHeaderPlan([future, oldPlacement, next], placement, '2026-09-12')).toEqual({ label: 'Next module', modules: [next] });
  });
  it('becomes current on the module start date and remains current on its end date', () => {
    for (const today of ['2026-10-05', '2027-02-11']) {
      expect(learnerHeaderPlan([future, next], placement, today)).toEqual({ label: 'Current module', modules: [next] });
    }
  });
  it('shows both modules when teaching periods overlap', () => {
    const overlap = module('Practical project', '2026-10-01', '2026-12-01');
    expect(learnerHeaderPlan([next, overlap, future], placement, '2026-10-10')).toEqual({ label: 'Current modules', modules: [overlap, next] });
  });
  it('does not describe a finished module as current', () => {
    expect(learnerHeaderPlan([next, future], placement, '2027-06-01')).toEqual({ label: 'Last module', modules: [future] });
  });
  it('keeps an assigned module visible when imported placement labels differ', () => {
    expect(learnerHeaderPlan([oldPlacement], placement, '2026-09-12').modules).toEqual([oldPlacement]);
  });
  it('matches placement names without case or whitespace differences', () => {
    expect(learnerHeaderPlan([next], { programme: ' marketing level 4 ', cohort: 'OCTOBER 2026', group: 'g1' }, '2026-09-12').modules).toEqual([next]);
  });
  it('keeps undated and older API records visible without claiming they are current', () => {
    const undated = module('Pending dates', null, null, { programme_name: '', cohort_name: '', group_name: '' });
    expect(learnerHeaderPlan([undated], placement, '2026-09-12')).toEqual({ label: 'Module', modules: [undated] });
  });
});
