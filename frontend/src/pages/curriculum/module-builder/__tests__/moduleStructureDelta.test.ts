import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalModuleDraft,
  moduleStructureDelta,
  recalculateModule,
  saveModuleStructure,
  type ModuleCatalogueItem,
} from '../moduleAuthoringData';

function storedModule(): ModuleCatalogueItem {
  const draft = createLocalModuleDraft({ programme: 'Programme', title: 'Module', description: '', weeks: 2, status: 'draft', catalogueId: 'MOD-TEST' });
  return recalculateModule({
    ...draft,
    weekStructure: draft.weekStructure.map((week, weekIndex) => ({
      ...week,
      id: `WEEK-${weekIndex + 1}`,
      components: [0, 1].map(index => ({
        ...(week.components[0] || {}),
        id: `COMP-${weekIndex + 1}${index}`,
        weekId: `WEEK-${weekIndex + 1}`,
        type: 'reading',
        title: `Reading ${weekIndex + 1}.${index}`,
        settings: { readingContent: '<p>long chapter text</p>' },
        ksbMappings: [],
      })) as ModuleCatalogueItem['weekStructure'][number]['components'],
    })),
  });
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('moduleStructureDelta', () => {
  it('carries no weeks or components when nothing changed, only their order', () => {
    const base = storedModule();
    const delta = moduleStructureDelta(base, clone(base));

    expect(delta.weeks).toEqual({});
    expect(delta.components).toEqual({});
    expect(delta.weekOrder).toEqual(['WEEK-1', 'WEEK-2']);
    expect(delta.componentOrder).toEqual({ 'WEEK-1': ['COMP-10', 'COMP-11'], 'WEEK-2': ['COMP-20', 'COMP-21'] });
  });

  it('ignores field order, which is not a change', () => {
    const base = storedModule();
    const current = clone(base);
    const component = current.weekStructure[0].components[0];
    current.weekStructure[0].components[0] = Object.fromEntries(Object.entries(component).reverse()) as typeof component;

    expect(moduleStructureDelta(base, current).components).toEqual({});
  });

  it('sends only the edited component and the edited week', () => {
    const base = storedModule();
    const current = clone(base);
    current.weekStructure[1].components[1].title = 'Renamed';
    current.weekStructure[0].title = 'New week title';

    const delta = moduleStructureDelta(base, current);

    expect(Object.keys(delta.components)).toEqual(['COMP-21']);
    expect(Object.keys(delta.weeks)).toEqual(['WEEK-1']);
    expect(delta.weeks['WEEK-1']).not.toHaveProperty('components');
  });

  it('expresses removals and moves through the order alone', () => {
    const base = storedModule();
    const current = clone(base);
    const [removed, moved] = current.weekStructure[0].components.splice(0, 2);
    current.weekStructure[1].components.unshift(moved);

    const delta = moduleStructureDelta(base, current);

    expect(delta.componentOrder['WEEK-1']).toEqual([]);
    expect(delta.componentOrder['WEEK-2']).toEqual(['COMP-11', 'COMP-20', 'COMP-21']);
    expect(Object.values(delta.componentOrder).flat()).not.toContain(removed.id);
  });
});

describe('saveModuleStructure', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(module: ModuleCatalogueItem) {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(module), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('sends only the changes when it has the saved copy and its revision', async () => {
    const base = storedModule();
    const current = clone(base);
    current.weekStructure[0].components[0].title = 'Edited';
    const fetchMock = stubFetch(current);

    await saveModuleStructure('MOD-TEST', current, { expectedRevision: 'REV-1', base });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.saveMode).toBe('partial');
    expect(body.expectedRevision).toBe('REV-1');
    expect(body).not.toHaveProperty('weekStructure');
    expect(Object.keys(body.structureDelta.components)).toEqual(['COMP-10']);
  });

  it('sends the whole structure without a saved copy to compare against', async () => {
    const current = storedModule();
    const fetchMock = stubFetch(current);

    await saveModuleStructure('MOD-TEST', current, { expectedRevision: 'REV-1' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).not.toHaveProperty('saveMode');
    expect(body.weekStructure).toHaveLength(2);
  });
});
