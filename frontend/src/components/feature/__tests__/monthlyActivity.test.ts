import { describe, expect, it } from 'vitest';

import {
  collapseRepeatedActivities,
  type MonthActivity,
} from '@/utils/monthlyActivity';
import { reportedTimeMinutes } from '@/utils/reportedTime';

function activity(overrides: Partial<MonthActivity>): MonthActivity {
  return {
    id: 'activity',
    at: '2026-09-01T10:00:00Z',
    type: 'video',
    title: 'Recorded Session 1',
    action: 'Watched video',
    ksbs: [],
    ...overrides,
  };
}

describe('monthly repeated activities', () => {
  it('keeps the highest attempt and exposes the number of attempts', () => {
    const collapsed = collapseRepeatedActivities([
      activity({ id: 'attempt-1', activityKey: 'component:video-1', attemptNumber: 1, reportedTime: '60', loggedMinutes: 60 }),
      activity({ id: 'attempt-2', activityKey: 'component:video-1', attemptNumber: 2, reportedTime: '60', loggedMinutes: 180, at: '2026-09-02T10:00:00Z' }),
    ]);

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].id).toBe('attempt-2');
    expect(collapsed[0].loggedMinutes).toBe(180);
    expect(collapsed[0].attemptCount).toBe(2);
  });

  it('allows the highest values of different activities to be summed', () => {
    const collapsed = collapseRepeatedActivities([
      activity({ id: 'video-1', activityKey: 'component:video-1', reportedTime: '60', loggedMinutes: 60 }),
      activity({ id: 'video-2', activityKey: 'component:video-1', reportedTime: '60', loggedMinutes: 180 }),
      activity({ id: 'reading-1', activityKey: 'component:reading-1', type: 'learning', reportedTime: '60', loggedMinutes: 120 }),
    ]);
    const total = collapsed.reduce(
      (sum, item) => sum + (
        item.loggedMinutes ?? reportedTimeMinutes(item.reportedTime) ?? 0
      ),
      0,
    );

    expect(total).toBe(300);
  });
});
