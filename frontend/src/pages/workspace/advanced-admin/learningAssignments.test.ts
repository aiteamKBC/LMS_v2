import { expect, it } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { StudentActivityResponse } from '@/api/studentActivity';
import { assignedAssessments } from './learningAssignments';

it('takes the assignment month and planned KSBs from the plan and achieved time from accepted records', () => {
  const current = {
    components: [{ componentId: 'assignment-1', component: 'Case study', module: 'Module A',
      moduleId: 'module-a', week: 'Week 1', type: 'assignment', expectedOtjh: 4,
      sessionDate: '2026-09-12', ksbMappings: [{ code: 'K1', description: null, classification: 'main', weight: 1 }] }],
    modules: [], componentProgress: [], videoProgress: [], quizAttempts: [],
  } as unknown as LearnerDetail;
  const historical = { activities: [], canonical_otjh_activities: [{
    id: 'progress-1', kind: 'component', componentId: 'assignment-1',
    componentTitle: 'Case study', componentType: 'assignment', actualSeconds: 5400, ksbs: ['K1'],
  }] } as unknown as StudentActivityResponse;

  expect(assignedAssessments({ current, historical })).toMatchObject([{
    activityId: 'assignment-1', month: '2026-09', plannedHours: 4,
    achievedHours: 1.5, completed: true, ksbCodes: ['K1'], achievedKsbCodes: ['K1'],
  }]);
});
