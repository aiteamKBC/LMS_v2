import { describe, expect, it } from 'vitest';
import type { StudentActivityItem } from '@/api/studentActivity';
import type { SubjectEntry } from './learningSummary';
import { combinedActivities } from './combinedActivities';

const parent: SubjectEntry = { id: 'catalogue:1:material:10', title: 'Read the chapter', category: 'Reading+Quiz',
  completed: true, position: 1, schedule: { date: null }, legacy: {
    activity_id: 'catalogue:1:material:10', source_activity_id: 10, group_id: 1, catalogue_kind: 'material',
  } as StudentActivityItem };
const quiz: SubjectEntry = { ...parent, id: 'catalogue:1:quiz:20', category: 'quiz', completed: false,
  legacy: { ...parent.legacy!, source_activity_id: 20, catalogue_kind: 'quiz', source_material_activity_id: parent.id } };

describe('combined imported reading and quiz navigation', () => {
  it('uses the exact parent once, keeps a saved quiz link usable and leaves evidence unchanged', () => {
    const entries = [quiz, parent];
    const before = JSON.stringify(entries);
    const result = combinedActivities(entries);
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]).toMatchObject({ id: parent.id, category: 'Reading + Quiz', completed: false });
    expect(result.aliases.get(quiz.id)).toBe(parent.id);
    expect(JSON.stringify(entries)).toBe(before);
    expect(combinedActivities([parent, { ...quiz, completed: true }]).activities[0].completed).toBe(true);
  });

  it.each(['another course', 'missing parent', 'unavailable parent', 'ambiguous quiz', 'same title only'])(
    'does not combine %s', reason => {
      let entries = [parent, quiz];
      if (reason === 'another course') entries = [parent, { ...quiz, legacy: { ...quiz.legacy!, group_id: 2 } }];
      if (reason === 'missing parent') entries = [quiz];
      if (reason === 'unavailable parent') entries = [{ ...parent, legacy: { ...parent.legacy!, can_open_material: false } }, quiz];
      if (reason === 'ambiguous quiz') entries.push({ ...quiz, id: 'catalogue:1:quiz:21' });
      if (reason === 'same title only') entries = [parent, { ...quiz, legacy: { ...quiz.legacy!, source_material_activity_id: undefined } }];
      expect(combinedActivities(entries).activities).toEqual(entries);
    });
});
