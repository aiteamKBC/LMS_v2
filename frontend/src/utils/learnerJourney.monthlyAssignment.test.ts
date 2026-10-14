import { describe, expect, it } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import { buildLearnerJourney, isMonthlyAssignment, monthlyAssignmentFlagsInUse } from './learnerJourney';

const assignment = (id: string, monthlyAssignment?: boolean) => ({ componentId: id, type: 'assignment', monthlyAssignment });
const reading = { componentId: 'R1', type: 'reading', monthlyAssignment: true };

describe('monthly assignment flag', () => {
  it('treats every assignment as monthly until an author flags one', () => {
    const plan = [assignment('A1'), assignment('A2', false), reading];
    expect(monthlyAssignmentFlagsInUse(plan)).toBe(false);
    expect(plan.map(component => isMonthlyAssignment(component, plan))).toEqual([true, true, false]);
  });

  it('treats only flagged assignments as monthly once any assignment in the plan is flagged', () => {
    const plan = [assignment('A1'), assignment('A2', true), assignment('A3', false), reading];
    expect(monthlyAssignmentFlagsInUse(plan)).toBe(true);
    expect(plan.map(component => isMonthlyAssignment(component, plan))).toEqual([false, true, false, false]);
  });

  it('accepts hyphenated or padded type names and ignores a flag on other component types', () => {
    expect(isMonthlyAssignment({ type: ' Assignment ' }, [])).toBe(true);
    expect(monthlyAssignmentFlagsInUse([reading])).toBe(false);
    expect(isMonthlyAssignment(reading, [reading])).toBe(false);
  });

  it('is safe before the plan has loaded', () => {
    expect(isMonthlyAssignment(null, null)).toBe(false);
    expect(isMonthlyAssignment(assignment('A1'), undefined)).toBe(true);
    expect(isMonthlyAssignment(assignment('A1', true), null)).toBe(true);
  });

  it('carries the flag from the learner payload into the journey used by the activity page', () => {
    const detail = { modules: ['Module'], week: [{ module: 'Module', week: 'Week 1', moduleId: 'M1', weekId: 'W1' }],
      components: [
        { module: 'Module', week: 'Week 1', moduleId: 'M1', weekId: 'W1', component: 'Assignment · Month 1', expectedOtjh: 2, ...assignment('A1', true) },
        { module: 'Module', week: 'Week 1', moduleId: 'M1', weekId: 'W1', component: 'Assignment · Slides task', expectedOtjh: 1, ...assignment('A2', false) },
      ], quizAttempts: [] } as unknown as LearnerDetail;
    const components = buildLearnerJourney(detail)[0].weeks[0].components;
    expect(components.map(component => component.monthlyAssignment)).toEqual([true, false]);
    expect(components.map(component => isMonthlyAssignment(component, detail.components))).toEqual([true, false]);
  });
});
