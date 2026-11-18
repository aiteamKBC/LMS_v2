import { describe, expect, it } from 'vitest';
import type { WebPoint } from '@/api/webWeekPoints';
import { createEmptyComponent } from './moduleAuthoringData';
import { assignPointComponents, movePointComponents, reorderWeekPoints } from './weekPointStructure';

const components = ['READ', 'VIDEO', 'QUIZ', 'OUTSIDE'].map((id, index) => ({
  ...createEmptyComponent('W1', 'reading', index + 1), id, title: id, settings: { readingContent: `Content ${id}`, requirement: 'Required' },
}));
const points: WebPoint[] = [{ id: 'P1', title: 'Explore', componentIds: ['READ', 'QUIZ'] }, { id: 'P2', title: 'Practice', componentIds: ['VIDEO'] }, { id: 'P3', title: 'Reflect', componentIds: [] }];

describe('week Point structure', () => {
  it.each([
    { from: 'READ', over: ['QUIZ'], target: 'P1', order: ['VIDEO', 'QUIZ', 'READ', 'OUTSIDE'], members: [['QUIZ', 'READ'], ['VIDEO'], []] },
    { from: 'READ', over: ['VIDEO'], target: 'P2', order: ['VIDEO', 'READ', 'QUIZ', 'OUTSIDE'], members: [['QUIZ'], ['VIDEO', 'READ'], []] },
    { from: 'OUTSIDE', over: ['READ'], target: 'P1', order: ['OUTSIDE', 'READ', 'VIDEO', 'QUIZ'], members: [['OUTSIDE', 'READ', 'QUIZ'], ['VIDEO'], []] },
    { from: 'READ', over: [], target: 'P3', order: ['VIDEO', 'QUIZ', 'OUTSIDE', 'READ'], members: [['QUIZ'], ['VIDEO'], ['READ']] },
    { from: 'READ', over: ['OUTSIDE'], target: null, order: ['VIDEO', 'QUIZ', 'OUTSIDE', 'READ'], members: [['QUIZ'], ['VIDEO'], []] },
    { from: 'OUTSIDE', over: ['VIDEO'], target: 'P2', order: ['READ', 'OUTSIDE', 'VIDEO', 'QUIZ'], members: [['READ', 'QUIZ'], ['OUTSIDE', 'VIDEO'], []] },
  ])('moves $from to $target over $over without rewriting any component', ({ from, over, target, order, members }) => {
    const before = structuredClone({ components, points });
    const result = movePointComponents(components, points, [from], target, over);
    expect(result.components.map(component => component.id)).toEqual(order);
    expect(result.points.map(point => point.componentIds)).toEqual(members);
    result.components.forEach(component => expect(component).toBe(components.find(original => original.id === component.id)));
    expect({ components, points }).toEqual(before);
  });

  it('moves a session and its displayed recording together while retaining their identities and settings', () => {
    const live = { ...createEmptyComponent('W1', 'live-session', 1), id: 'LIVE', settings: { teamsLiveSessionId: 'SYNTHETIC', sessionDate: '2026-11-16' } };
    const recording = { ...createEmptyComponent('W1', 'recording-placeholder', 2), id: 'RECORDING', settings: { linkedLiveSessionComponentId: 'LIVE' } };
    const list = [live, recording, components[0]];
    const groups = [{ ...points[0], componentIds: ['LIVE', 'RECORDING'] }, { ...points[1], componentIds: ['READ'] }];
    const result = movePointComponents(list, groups, ['LIVE', 'RECORDING'], 'P2', ['READ']);
    expect(result.components).toEqual([components[0], live, recording]);
    expect(result.points.map(point => point.componentIds)).toEqual([[], ['READ', 'LIVE', 'RECORDING']]);
    expect(result.components[1]).toBe(live);
    expect(result.components[2]).toBe(recording);
  });

  it('reorders Points without changing membership or component data', () => {
    expect(reorderWeekPoints(points, 'P1', 'P3')).toEqual([points[1], points[2], points[0]]);
    expect(reorderWeekPoints(points, 'missing', 'P2')).toBe(points);
  });

  it('assigns new activities and preserves stale references and unrelated Points', () => {
    const source = [{ ...points[0], componentIds: ['READ', 'REMOVED', 'QUIZ'] }, points[1]];
    const result = assignPointComponents(source, 'P1', ['OUTSIDE'], components);
    expect(result[0].componentIds).toEqual(['READ', 'REMOVED', 'QUIZ', 'OUTSIDE']);
    expect(result[1]).toBe(points[1]);
  });

  it('ignores missing targets, missing sources and drops onto the same group', () => {
    for (const [ids, target, over] of [[['READ'], 'missing', ['VIDEO']], [['missing'], 'P1', []], [['READ'], 'P1', ['READ']]] as [string[], string, string[]][]) {
      const result = movePointComponents(components, points, ids, target, over);
      expect(result.components).toBe(components);
      expect(result.points).toBe(points);
    }
  });
});
