import { describe, expect, it } from 'vitest';
import { groupPointActivities } from '../pointActivities';
import { buildLearnerJourney } from '../learnerJourney';

describe('point activity navigation', () => {
  it('keeps every canonical identity and authored reading/audio pair, with the quiz last', () => {
    const rows = [
      { componentId: 'R1', type: 'reading', pointNumber: 1 },
      { componentId: 'Q1', type: 'quiz', pointNumber: 1 },
      { componentId: 'A1', type: 'podcast', pointNumber: 1 },
      { componentId: 'R2', type: 'reading', pointNumber: 1 },
      { componentId: 'A2', type: 'podcast', pointNumber: 1 },
    ];
    const before = structuredClone(rows);
    const groups = groupPointActivities(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].activities.map(row => row.componentId)).toEqual(['R1', 'A1', 'R2', 'A2', 'Q1']);
    expect(groups[0].activities.every(row => rows.includes(row))).toBe(true);
    expect(rows).toEqual(before);
  });

  it('leaves untagged, malformed and different week/module activities separate', () => {
    const rows = [
      { type: 'video' }, { pointNumber: 0 }, { pointNumber: -1 }, { pointNumber: 1.5 },
      { pointNumber: 1, moduleId: 'M1', weekId: 'W1' },
      { pointNumber: 1, moduleId: 'M1', weekId: 'W2' },
      { pointNumber: 1, moduleId: 'M2', weekId: 'W1' },
    ];
    const groups = groupPointActivities(rows);
    expect(groups).toHaveLength(7);
    expect(groups.slice(0, 4).every(group => group.pointNumber === null)).toBe(true);
    expect(groups.flatMap(group => group.activities)).toEqual(rows);
  });

  it('carries point metadata through the compact journey without changing identity or progress', () => {
    const source = { modules: ['AI'], week: [{ module: 'AI', week: 'Week 1', moduleId: 'M1', weekId: 'W1' }],
      components: [{ module: 'AI', week: 'Week 1', moduleId: 'M1', weekId: 'W1', componentId: 'R1',
        component: 'Reading', type: 'reading', expectedOtjh: 2, pointNumber: 1 }], quizAttempts: [] };
    const row = buildLearnerJourney(source)[0].weeks[0].components[0];
    expect(row).toMatchObject({ componentId: 'R1', pointNumber: 1, expectedOtjh: 2, moduleId: 'M1', weekId: 'W1' });
  });
});
