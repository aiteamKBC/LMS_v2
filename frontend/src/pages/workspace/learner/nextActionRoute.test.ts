import { describe, expect, it } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import { learnerNextAction } from './nextActionRoute';

const detail = {
  modules: ['Risk Management'],
  week: [{ module: 'Risk Management', week: 'Week 01', moduleId: 'M1', weekId: 'W1' }],
  components: [
    { module: 'Risk Management', week: 'Week 01', moduleId: 'M1', weekId: 'W1', component: 'Join the live session', componentId: 'LIVE', type: 'live_session', sessionDate: '2026-09-25' },
    { module: 'Risk Management', week: 'Week 01', moduleId: 'M1', weekId: 'W1', component: 'Submit assignment', componentId: 'ASSIGNMENT', type: 'assignment', assignmentBrief: 'Submit your work' },
    { module: 'Risk Management', week: 'Week 01', moduleId: 'M1', weekId: 'W1', component: 'Risk register explainer', componentId: 'VIDEO', type: 'video', videoUrl: 'https://cdn.example/video.mp4' },
  ],
  videoProgress: [], componentProgress: [], quizAttempts: [],
} as unknown as LearnerDetail;

describe('learner next action', () => {
  it('skips live sessions and assignments and opens the next learning activity', () => {
    expect(learnerNextAction(detail, 'commercial', '71')).toEqual({
      title: 'Risk register explainer',
      description: 'Risk Management · Week 01',
      href: '/learner/video/commercial/71/VIDEO?module=Risk%20Management&week=Week%2001',
    });
  });

  it('returns no action when the module only contains the dedicated card types', () => {
    const onlyDedicated = { ...detail, components: detail.components.slice(0, 2) } as unknown as LearnerDetail;
    expect(learnerNextAction(onlyDedicated, 'commercial', '71')).toBeNull();
  });

  it('limits the next action to the active module set', () => {
    const anotherMonth = { ...detail, components: [
      ...detail.components,
      { ...detail.components[2], module: 'Next module', week: 'Week 02', moduleId: 'M2', weekId: 'W2', componentId: 'VIDEO-NEXT-MONTH' },
    ], modules: ['Risk Management', 'Next module'], week: [
      ...detail.week,
      { module: 'Next module', week: 'Week 02', moduleId: 'M2', weekId: 'W2' },
    ] } as unknown as LearnerDetail;
    expect(learnerNextAction(anotherMonth, 'commercial', '71', ['M2'])?.href).toContain('VIDEO-NEXT-MONTH');
  });
});
