import { describe, expect, it } from 'vitest';
import { componentSuggestions } from './componentSuggestions';
const source = { sourceActivityRef: 'material:7', title: 'Old title', type: 'quiz', week: '', automaticTargetId: null,
  contentAvailable: true, contentScores: [{ componentId: 'A', score: 0.95 }, { componentId: 'B', score: 0.1 }] };
const targets = [
  { componentId: 'B', title: 'Old title', type: 'quiz', week: '', plannedHours: null },
  { componentId: 'A', title: 'Different title, matching questions', type: 'quiz', week: '', plannedHours: null },
];
describe('component content recommendations', () => {
  it('uses content scores rather than matching titles', () => {
    const result = componentSuggestions(source, targets, new Set());
    expect(result.candidates.map(t => t.componentId)).toEqual(['A', 'B']);
    expect(result.suggestedId).toBe('A');
  });
  it('does not recommend used, wrong-type or unknown-type components', () => {
    const result = componentSuggestions(source, targets, new Set(['A']));
    expect(result.candidates.map(t => t.componentId)).toEqual(['B', 'A']);
    expect(result.suggestedId).toBeNull();
    expect(componentSuggestions({ ...source, type: 'reading' }, targets, new Set()).candidates).toEqual([]);
    expect(componentSuggestions({ ...source, type: 'unknown' }, [{ ...targets[0], type: 'unknown' }], new Set()).candidates).toEqual([]);
  });
  it('does not imply that missing, weak or tied content is recommended', () => {
    for (const contentScores of [[], [{ componentId: 'A', score: null }], [{ componentId: 'A', score: 0.2 }],
      [{ componentId: 'A', score: 0.9 }, { componentId: 'B', score: 0.9 }]]) {
      expect(componentSuggestions({ ...source, contentScores }, targets, new Set()).suggestedId).toBeNull();
    }
    expect(componentSuggestions({ ...source, contentAvailable: false }, targets, new Set()).suggestedId).toBeNull();
  });
});
