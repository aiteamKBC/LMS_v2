import { describe, expect, it } from 'vitest';
import type { TransferReview } from '@/api/progressTransfer';
import { previewComponentCounts } from './componentCounts';

const module: TransferReview['modules'][number] = {
  moduleId: 'M1', courseRef: 'legacy:50', title: 'Example module', completedTargetIds: ['A', 'FOREIGN'],
  sources: [
    { sourceActivityRef: 'material:1', title: 'Automatic', type: 'reading', week: '', automaticTargetId: 'A' },
    { sourceActivityRef: 'material:2', title: 'Manual', type: 'reading', week: '', automaticTargetId: null },
  ],
  targets: ['A', 'B', 'C'].map(componentId => ({ componentId, title: componentId, type: 'reading', week: 'Week 1', plannedHours: null })),
};

describe('component counts after transfer', () => {
  it('keeps passed archived quiz credit in the preview without duplicating active destinations', () => {
    expect(previewComponentCounts({ ...module, retainedCompletedIds: ['OLD', 'OLD', 'A'] }, []))
      .toEqual({ total: 4, matched: 1, completed: 2, remaining: 2 });
  });
  it('counts existing and transferred completion once and updates when a match is selected or cleared', () => {
    const before = structuredClone(module);
    expect(previewComponentCounts(module, [])).toEqual({ total: 3, matched: 1, completed: 1, remaining: 2 });
    const mapping = { moduleId: 'M1', sourceActivityRef: 'material:2', targetComponentId: 'B' };
    expect(previewComponentCounts(module, [mapping, mapping])).toEqual({ total: 3, matched: 2, completed: 2, remaining: 1 });
    expect(previewComponentCounts(module, [])).toEqual({ total: 3, matched: 1, completed: 1, remaining: 2 });
    expect(module).toEqual(before);
  });
  it('ignores foreign sources/modules, missing destinations and duplicate target placements', () => {
    const mappings = [
      { moduleId: 'M2', sourceActivityRef: 'material:2', targetComponentId: 'B' },
      { moduleId: 'M1', sourceActivityRef: 'material:99', targetComponentId: 'C' },
      { moduleId: 'M1', sourceActivityRef: 'material:2', targetComponentId: 'FOREIGN' },
    ];
    expect(previewComponentCounts({ ...module, targets: [...module.targets, module.targets[0]] }, mappings))
      .toEqual({ total: 3, matched: 1, completed: 1, remaining: 2 });
  });
  it('preserves zero and unknown counts without inferring completion from a percentage', () => {
    expect(previewComponentCounts({ ...module, sources: [], targets: [], completedTargetIds: [] }, []))
      .toEqual({ total: 0, matched: 0, completed: 0, remaining: 0 });
    expect(previewComponentCounts({ ...module, completedTargetIds: undefined }, []))
      .toEqual({ total: 3, matched: 1, completed: null, remaining: null });
    expect(previewComponentCounts({ ...module, completedTargetIds: ['A', 'B', 'C'] }, []))
      .toEqual({ total: 3, matched: 1, completed: 3, remaining: 0 });
  });
});
