import { describe, expect, it } from 'vitest';
import {
  calculateQualityChecklist,
  createEmptyComponent,
  createLocalModuleDraft,
  recalculateModule,
  type ModuleCatalogueItem,
} from '../moduleAuthoringData';

/**
 * A module's OTJH is one number with one rule: add up the Expected OTJH of every
 * component, in every week. Nothing else contributes - not the week count, not
 * the session plan, not a total typed into Module settings, and not a stale
 * aggregate the API happens to still be carrying.
 */
function moduleWithOtjh(weekHours: number[][]): ModuleCatalogueItem {
  const draft = createLocalModuleDraft({
    programme: 'OTJH Programme',
    title: 'OTJH module',
    description: '',
    weeks: weekHours.length,
    status: 'draft',
    catalogueId: 'MOD-OTJH',
  });
  return recalculateModule({
    ...draft,
    weekStructure: draft.weekStructure.map((week, weekIndex) => ({
      ...week,
      components: (weekHours[weekIndex] || []).map((hours, componentIndex) => ({
        ...createEmptyComponent(week.id, 'reading', componentIndex + 1),
        expectedOtjh: hours,
      })),
    })),
  });
}

describe('module OTJH total', () => {
  it('adds every component in every week', () => {
    // Week 1: 2h + 3h. Week 2: 4h. The module is 9h.
    const module = moduleWithOtjh([[2, 3], [4]]);
    expect(module.totalOtjh).toBe(9);
  });

  it('keeps quarter hours exact rather than rounding each week', () => {
    const module = moduleWithOtjh([[0.25, 0.25], [0.25, 0.75]]);
    expect(module.totalOtjh).toBeCloseTo(1.5, 5);
  });

  it('counts a component left at zero as zero, not as its type default', () => {
    const module = moduleWithOtjh([[2, 0], [0]]);
    expect(module.totalOtjh).toBe(2);
  });

  it('is zero for a module with weeks but no components', () => {
    expect(moduleWithOtjh([[], []]).totalOtjh).toBe(0);
  });

  it('ignores a declared total that disagrees with the components', () => {
    const module = recalculateModule({ ...moduleWithOtjh([[2, 3], [4]]), declaredTotalOtjh: 40 });
    expect(module.totalOtjh).toBe(9);
    // Pinned to the sum, so Module settings cannot show 40h beside a 9h header.
    expect(module.declaredTotalOtjh).toBe(9);
    const otjhCheck = calculateQualityChecklist(module).find(item => item.label === 'Total module OTJH matches component sum');
    expect(otjhCheck?.passed).toBe(true);
  });

  it('adds a newly added component, whatever OTJH it carries', () => {
    // The module starts at 2h + 3h + 4h = 9h.
    const module = moduleWithOtjh([[2, 3], [4]]);
    expect(module.totalOtjh).toBe(9);

    // A 5h component on week 1 and a 0.5h one on week 2: 9 + 5 + 0.5 = 14.5h.
    const grown = recalculateModule({
      ...module,
      weekStructure: module.weekStructure.map((week, index) => ({
        ...week,
        components: [
          ...week.components,
          { ...createEmptyComponent(week.id, 'assignment', week.components.length + 1), expectedOtjh: index === 0 ? 5 : 0.5 },
        ],
      })),
    });
    expect(grown.totalOtjh).toBe(14.5);
    // And the number Module settings shows moves with it.
    expect(grown.declaredTotalOtjh).toBe(14.5);
  });

  it('moves with the components as weeks are edited', () => {
    const module = moduleWithOtjh([[2, 3], [4]]);
    const withExtraComponent = recalculateModule({
      ...module,
      weekStructure: module.weekStructure.map((week, index) => (index === 1
        ? { ...week, components: [...week.components, { ...createEmptyComponent(week.id, 'reading', 2), expectedOtjh: 1.5 }] }
        : week)),
    });
    expect(withExtraComponent.totalOtjh).toBe(10.5);

    const withoutSecondWeek = recalculateModule({ ...module, weekStructure: [module.weekStructure[0]] });
    expect(withoutSecondWeek.totalOtjh).toBe(5);
  });
});
