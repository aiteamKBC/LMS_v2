/**
 * Adding a week template's components to a week that already has some.
 *
 * The module header's template button builds a whole new week. Picking a
 * template from inside a week has to do the opposite: land the components
 * beside the ones already authored there. The failure worth guarding is a
 * template replacing a week's contents rather than adding to it -- that loses
 * work silently, and the week still looks populated afterwards.
 *
 * This covers the merge the page performs in `addWeekTemplateToWeek`. Ids are
 * regenerated on the way in, so two modules built from one template never claim
 * the same component id.
 */
import { describe, expect, it } from 'vitest';

type Mapping = { id: string; code?: string };
type Component = { id: string; weekId: string; title: string; ksbMappings?: Mapping[] };
type Week = { id: string; title: string; components: Component[]; ksbMappings?: Mapping[] };
type Template = { title: string; components?: Component[]; ksbMappings?: Mapping[] };

let counter = 0;
const makeAuthoringId = (prefix: string) => `${prefix}-generated-${++counter}`;

/** The merge performed by `addWeekTemplateToWeek` in page.tsx. */
function addTemplateToWeek(week: Week, template: Template): Week {
  const copies = (template.components || []).map(component => ({
    ...component,
    id: makeAuthoringId('component'),
    weekId: week.id,
    ksbMappings: (component.ksbMappings || []).map(mapping => ({ ...mapping, id: makeAuthoringId('ksb') })),
  }));
  return {
    ...week,
    components: [...week.components, ...copies],
    ksbMappings: [
      ...(week.ksbMappings || []),
      ...(template.ksbMappings || []).map(mapping => ({ ...mapping, id: makeAuthoringId('ksb') })),
    ],
  };
}

const week = (): Week => ({
  id: 'WEEK-1',
  title: 'Week 1 — Foundations',
  components: [
    { id: 'COMP-EXISTING-1', weekId: 'WEEK-1', title: 'Existing lecture' },
    { id: 'COMP-EXISTING-2', weekId: 'WEEK-1', title: 'Existing reading' },
  ],
  ksbMappings: [{ id: 'ksb-existing', code: 'K1' }],
});

const template = (): Template => ({
  title: 'Reusable week',
  components: [
    { id: 'COMP-TEMPLATE-1', weekId: 'WEEK-OTHER', title: 'Template video', ksbMappings: [{ id: 'ksb-t', code: 'S2' }] },
    { id: 'COMP-TEMPLATE-2', weekId: 'WEEK-OTHER', title: 'Template quiz' },
  ],
  ksbMappings: [{ id: 'ksb-template', code: 'B3' }],
});

describe('adding a week template into an existing week', () => {
  it('keeps the components already in the week', () => {
    const result = addTemplateToWeek(week(), template());

    expect(result.components.map(c => c.title)).toEqual([
      'Existing lecture',
      'Existing reading',
      'Template video',
      'Template quiz',
    ]);
  });

  it('appends rather than replacing', () => {
    const result = addTemplateToWeek(week(), template());

    expect(result.components).toHaveLength(4);
  });

  it('rebinds every copied component to this week', () => {
    // Left on the template's own weekId, a component would belong to a week in
    // a different module.
    const result = addTemplateToWeek(week(), template());

    expect(result.components.every(c => c.weekId === 'WEEK-1')).toBe(true);
  });

  it('gives the copies fresh ids', () => {
    // Two modules built from one template must not claim the same component id.
    const result = addTemplateToWeek(week(), template());
    const added = result.components.slice(2);

    expect(added.map(c => c.id)).not.toContain('COMP-TEMPLATE-1');
    expect(new Set(result.components.map(c => c.id)).size).toBe(4);
  });

  it('regenerates KSB mapping ids on the copied components', () => {
    const result = addTemplateToWeek(week(), template());
    const copied = result.components.find(c => c.title === 'Template video');

    expect(copied?.ksbMappings?.[0].id).not.toBe('ksb-t');
    expect(copied?.ksbMappings?.[0].code).toBe('S2');
  });

  it("merges the template's KSB mappings into the week's own", () => {
    const result = addTemplateToWeek(week(), template());

    expect(result.ksbMappings?.map(m => m.code)).toEqual(['K1', 'B3']);
  });

  it('leaves the week title alone', () => {
    // The week keeps its identity; only components are being added.
    const result = addTemplateToWeek(week(), template());

    expect(result.title).toBe('Week 1 — Foundations');
  });

  it('is a no-op on the components when the template is empty', () => {
    const result = addTemplateToWeek(week(), { title: 'Empty' });

    expect(result.components).toHaveLength(2);
  });

  it('works on a week that has nothing in it yet', () => {
    const empty: Week = { id: 'WEEK-1', title: 'Week 1', components: [] };
    const result = addTemplateToWeek(empty, template());

    expect(result.components).toHaveLength(2);
  });
});
