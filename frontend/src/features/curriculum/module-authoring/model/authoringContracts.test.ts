import { describe, expect, it } from 'vitest';
import { createLocalModuleDraft, createEmptyComponent, type KsbOption } from '@/pages/curriculum/module-builder/moduleAuthoringData';
import { addKsbMapping, mappingsForTarget, removeKsbMapping, updateKsbMappingWeight, updateKsbMappingWeightClass, type KsbTarget } from './ksbMappings';
import { clampKsbWeight, clampPositiveKsbWeight, normaliseKsbMappingType, normaliseKsbWeightClass, ksbWeightSummary } from './ksbWeights';
import { ksbSourceIdsMatch } from './ksbSources';
import { moduleKsbMapRows } from './ksbCoverage';
import { moveById } from './draftTransforms';
import { toggleComponentType } from './componentSelection';
import { workspaceSaveStatus, type WorkspaceSaveStatus } from './saveState';

function draft() {
  const module = createLocalModuleDraft({ programme: 'Synthetic', title: 'Module', description: '', weeks: 1, status: 'draft', catalogueId: 'MOD-SYNTHETIC' });
  module.weekStructure[0].components = [createEmptyComponent(module.weekStructure[0].id, 'reading', 1)];
  return module;
}
const option: KsbOption = { id: 'K1', code: 'K1', description: 'Synthetic knowledge', sourceType: 'standard', sourceId: 'standard:one' };

describe('authoring draft contracts', () => {
  it.each(['module', 'week', 'component'] as const)('updates only the selected %s mapping scope without mutating the input', scope => {
    const original = draft();
    const week = original.weekStructure[0];
    const target: KsbTarget = scope === 'module' ? { scope } : scope === 'week' ? { scope, weekId: week.id } : { scope, weekId: week.id, componentId: week.components[0].id };
    const before = JSON.stringify(original);
    const added = addKsbMapping(original, target, option);
    const mapping = mappingsForTarget(added, target)[0];
    expect(mapping).toMatchObject({ code: 'K1', weight: 50, weightClass: 'hard', classification: 'main' });
    expect(JSON.stringify(original)).toBe(before);
    expect(addKsbMapping(added, target, { ...option, code: ' k1 ', sourceId: ' STANDARD:ONE ' })).toBe(added);
    const changed = updateKsbMappingWeight(added, target, mapping.id, 12.345);
    expect(mappingsForTarget(changed, target)[0].weight).toBe(12.35);
    const reclassified = updateKsbMappingWeightClass(changed, target, mapping.id, 'soft');
    expect(mappingsForTarget(reclassified, target)[0]).toMatchObject({ weight: 30, weightClass: 'soft', weight_class: 'soft', classification: 'main' });
    expect(mappingsForTarget(removeKsbMapping(reclassified, target, mapping.id), target)).toEqual([]);
    expect(mappingsForTarget(added, target)[0].weight).toBe(50);
  });

  it('does not assign a mapping to an absent week or component', () => {
    const module = draft();
    const target: KsbTarget = { scope: 'component', weekId: 'missing', componentId: 'missing' };
    expect(mappingsForTarget(addKsbMapping(module, target, option), target)).toEqual([]);
    expect(addKsbMapping(module, target, option)).toEqual(module);
  });

  it('keeps the same code from different standards separate', () => {
    const target: KsbTarget = { scope: 'module' };
    const first = addKsbMapping(draft(), target, option);
    const second = addKsbMapping(first, target, { ...option, sourceId: 'standard:two' });
    expect(second.moduleKsbMappings).toHaveLength(2);
    expect(ksbWeightSummary(second.moduleKsbMappings)).toEqual({ knowledge: 100, skills: 0, behaviours: 0, total: 100 });
  });

  it('keeps component coverage attached to its actual week column', () => {
    const original = draft();
    const week = original.weekStructure[0];
    week.title = 'Week 99 / custom title';
    const module = addKsbMapping(original, { scope: 'component', weekId: week.id, componentId: week.components[0].id }, option);
    const rows = moduleKsbMapRows(module, { 'standard:one': 'Synthetic standard' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'K1', applied: true, weight: 50 });
    expect(rows[0].placements[0]).toMatchObject({ scope: 'Component', columnKey: 'week:0' });
  });

  it('preserves legacy source aliases without merging distinct standards', () => {
    expect(ksbSourceIdsMatch('profile:KSBP-12', '12')).toBe(true);
    expect(ksbSourceIdsMatch('standard:one', 'standard:two')).toBe(false);
  });

  it('preserves weight validation and legacy classification fallbacks', () => {
    expect(clampKsbWeight(Number.NaN)).toBe(0);
    expect(clampKsbWeight(-4)).toBe(0);
    expect(clampPositiveKsbWeight(0, 'soft')).toBe(30);
    expect(normaliseKsbMappingType('practice')).toBe('possible');
    expect(normaliseKsbWeightClass(undefined, normaliseKsbMappingType('practice'))).toBe('possible');
  });

  it('reorders identifiers immutably and preserves missing-target no-ops', () => {
    const input = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(moveById(input, 'c', 'a').map(row => row.id)).toEqual(['c', 'a', 'b']);
    expect(input.map(row => row.id)).toEqual(['a', 'b', 'c']);
    expect(moveById(input, 'missing', 'a')).toBe(input);
  });

  it('toggles component selections without mutating their owner', () => {
    const input = new Set<'reading' | 'quiz'>(['reading']);
    expect([...toggleComponentType(input, 'quiz')]).toEqual(['reading', 'quiz']);
    expect([...toggleComponentType(input, 'reading')]).toEqual([]);
    expect([...input]).toEqual(['reading']);
  });
});

describe('save status priority', () => {
  const base = { workingModuleProgrammeArchived: false, saving: false, confirmingSave: false, savingSnapshot: '', workingModuleSnapshot: 'draft', saveFailure: null, hasUnsavedWorkingModuleChanges: false, autoSaveEnabled: false };
  const cases: Array<[WorkspaceSaveStatus, Partial<Parameters<typeof workspaceSaveStatus>[0]>]> = [
    ['saved', {}], ['manual', { hasUnsavedWorkingModuleChanges: true }],
    ['pending', { hasUnsavedWorkingModuleChanges: true, autoSaveEnabled: true }],
    ['saving', { saving: true }], ['saving', { saving: true, savingSnapshot: 'draft' }],
    ['saving-more', { saving: true, savingSnapshot: 'previous' }],
    ['checking', { saving: true, confirmingSave: true, savingSnapshot: 'previous' }],
    ['conflict', { saveFailure: { kind: 'conflict', message: 'Synthetic' } }],
    ['unconfirmed', { saveFailure: { kind: 'unconfirmed', message: 'Synthetic' } }],
    ['failed', { saveFailure: { kind: 'error', message: 'Synthetic' } }],
    ['locked', { workingModuleProgrammeArchived: true, saving: true, confirmingSave: true }],
    ['saving', { saving: true, saveFailure: { kind: 'error', message: 'Previous failure' } }],
  ];
  it.each(cases)('returns %s for the existing state priority', (expected, values) => {
    expect(workspaceSaveStatus({ ...base, ...values })).toBe(expected);
  });
});
