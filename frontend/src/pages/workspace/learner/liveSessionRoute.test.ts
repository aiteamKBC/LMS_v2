import { describe, expect, it } from 'vitest';
import type { LearnerDetail } from '@/api/learnerDetail';
import { learnerLiveSessionHref } from './liveSessionRoute';

const detail = {
  modules: ['Risk Management'],
  week: [{ module: 'Risk Management', week: 'Week 01', moduleId: 'M1', weekId: 'W1' }],
  components: [{
    module: 'Risk Management', week: 'Week 01', moduleId: 'M1', weekId: 'W1',
    component: 'Join your live Risk Management session', componentId: 'C-LIVE',
    type: 'live_session', sessionDate: '2026-09-25',
  }],
} as unknown as LearnerDetail;

describe('learner live-session routes', () => {
  it('opens the authored live-session activity instead of the module overview', () => {
    expect(learnerLiveSessionHref(detail, {
      title: 'Risk Management', date: '2026-09-25T09:00:00Z', moduleId: 'M1',
    }, 'commercial', '71')).toBe(
      '/learner/component/commercial/71/C-LIVE?module=Risk%20Management&week=Week%2001',
    );
  });

  it('does not guess when multiple live activities have no matching date', () => {
    const multiple = { ...detail, components: [
      ...detail.components,
      { ...detail.components[0], componentId: 'C-LIVE-2', sessionDate: '2026-10-02' },
    ] } as unknown as LearnerDetail;
    expect(learnerLiveSessionHref(multiple, {
      title: 'Risk Management', date: '2026-09-30T09:00:00Z', moduleId: 'M1',
    }, 'commercial', '71')).toBeNull();
  });
});
