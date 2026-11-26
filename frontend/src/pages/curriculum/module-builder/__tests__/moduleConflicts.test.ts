import { describe, expect, it } from 'vitest';
import { mergeModuleStructures } from '../../shared/entities/mergeModuleStructure';
import { recalculateModule, type ModuleCatalogueItem } from '../moduleAuthoringData';
import { applyTheirs, conflictsFromCollisions, conflictsFromServer, mergeConflictLists } from '../moduleConflicts';

/**
 * Two people changed the same thing. The Builder now asks rather than keeping
 * one side silently (D2), and "use theirs" must put exactly the other editor's
 * version back -- one field, one deleted item, one order -- and touch nothing
 * else on the reader's screen.
 */

function module(overrides: Partial<ModuleCatalogueItem> = {}): ModuleCatalogueItem {
  return recalculateModule({
    id: 'module-MOD-1',
    catalogueId: 'MOD-1',
    programmeId: 'PROG-1',
    programmeName: 'Programme',
    title: 'Module',
    description: '',
    status: 'draft',
    weeks: 2,
    sessionsNumber: 2,
    totalOtjh: 0,
    ksbCount: 0,
    lessonCount: 0,
    quizCount: 0,
    qualityScore: 0,
    moduleKsbMappings: [],
    completionCriteria: {} as ModuleCatalogueItem['completionCriteria'],
    advancedDetails: {} as ModuleCatalogueItem['advancedDetails'],
    background: '',
    epaRequirements: [],
    qualificationOutcomes: [],
    weekStructure: [
      {
        id: 'W1', moduleId: 'MOD-1', weekNumber: 1, title: 'Week 1', summary: '', learningOutcomes: [], ksbMappings: [],
        components: [
          { id: 'C1', moduleId: 'MOD-1', weekId: 'W1', type: 'reading', title: 'Reading one', description: '', expectedOtjh: 1, points: 0, reflectionRequired: false, workplaceEvidenceRequired: false, tutorValidationRequired: false, ksbMappings: [], settings: { readingContent: '<p>One</p>' } },
          { id: 'C2', moduleId: 'MOD-1', weekId: 'W1', type: 'reading', title: 'Reading two', description: '', expectedOtjh: 1, points: 0, reflectionRequired: false, workplaceEvidenceRequired: false, tutorValidationRequired: false, ksbMappings: [], settings: {} },
          { id: 'C3', moduleId: 'MOD-1', weekId: 'W1', type: 'reading', title: 'Reading three', description: '', expectedOtjh: 1, points: 0, reflectionRequired: false, workplaceEvidenceRequired: false, tutorValidationRequired: false, ksbMappings: [], settings: {} },
        ],
      },
      { id: 'W2', moduleId: 'MOD-1', weekNumber: 2, title: 'Week 2', summary: '', learningOutcomes: [], ksbMappings: [], components: [] },
    ],
    ...overrides,
  } as unknown as ModuleCatalogueItem);
}

function edit(source: ModuleCatalogueItem, change: (copy: ModuleCatalogueItem) => void): ModuleCatalogueItem {
  const copy = JSON.parse(JSON.stringify(source)) as ModuleCatalogueItem;
  change(copy);
  return recalculateModule(copy);
}

const component = (target: ModuleCatalogueItem, id: string) => target.weekStructure.flatMap(week => week.components).find(item => item.id === id);

describe('module conflicts', () => {
  it('asks about a field both changed and takes their value on "use theirs"', () => {
    const base = module();
    const mine = edit(base, copy => { copy.weekStructure[0].components[0].title = 'Mine'; copy.weekStructure[0].components[1].title = 'Only mine'; });
    const theirs = edit(base, copy => { copy.weekStructure[0].components[0].title = 'Theirs'; });
    const { module: merged, collisions } = mergeModuleStructures(base, mine, theirs);
    const conflicts = conflictsFromCollisions(merged, collisions);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].path).toBe('weekStructure[W1].components[C1].title');
    expect(conflicts[0].question).toContain('Theirs');
    // Still the reader's until they choose.
    expect(component(merged, 'C1')?.title).toBe('Mine');
    const resolved = applyTheirs(merged, conflicts[0]);
    expect(component(resolved, 'C1')?.title).toBe('Theirs');
    expect(component(resolved, 'C2')?.title).toBe('Only mine');
  });

  it('a rich text clash is asked about, not decided', () => {
    const base = module();
    const mine = edit(base, copy => { copy.weekStructure[0].components[0].settings = { ...copy.weekStructure[0].components[0].settings, readingContent: '<p>Mine</p>' }; });
    const theirs = edit(base, copy => { copy.weekStructure[0].components[0].settings = { ...copy.weekStructure[0].components[0].settings, readingContent: '<p>Theirs</p>' }; });
    const { module: merged, collisions } = mergeModuleStructures(base, mine, theirs);
    const [conflict] = conflictsFromCollisions(merged, collisions);
    expect(conflict.path).toBe('weekStructure[W1].components[C1].settings.readingContent');
    expect(component(applyTheirs(merged, conflict), 'C1')?.settings.readingContent).toBe('<p>Theirs</p>');
  });

  it('their delete of something I edited: "delete it" removes it, "keep mine" leaves it', () => {
    const base = module();
    const mine = edit(base, copy => { copy.weekStructure[0].components[0].title = 'Mine'; });
    const theirs = edit(base, copy => { copy.weekStructure[0].components.shift(); });
    const { module: merged, collisions } = mergeModuleStructures(base, mine, theirs);
    const [conflict] = conflictsFromCollisions(merged, collisions);
    expect(conflict.kind).toBe('remote-deleted');
    expect(conflict.itemId).toBe('C1');
    expect(component(merged, 'C1')?.title).toBe('Mine');
    expect(component(applyTheirs(merged, conflict), 'C1')).toBeUndefined();
  });

  it('their edit of something I deleted: "restore theirs" puts their copy back', () => {
    const base = module();
    const mine = edit(base, copy => { copy.weekStructure[0].components.shift(); });
    const theirs = edit(base, copy => { copy.weekStructure[0].components[0].title = 'Theirs'; });
    const { module: merged, collisions } = mergeModuleStructures(base, mine, theirs);
    const [conflict] = conflictsFromCollisions(merged, collisions);
    expect(conflict.kind).toBe('local-deleted');
    expect(component(merged, 'C1')).toBeUndefined();
    expect(component(applyTheirs(merged, conflict), 'C1')?.title).toBe('Theirs');
  });

  it('two different orders of one week: "use theirs" takes their order', () => {
    const base = module();
    const mine = edit(base, copy => { copy.weekStructure[0].components.reverse(); });
    const theirs = edit(base, copy => {
      const [first, second, third] = copy.weekStructure[0].components;
      copy.weekStructure[0].components = [second, first, third];
    });
    const { module: merged, collisions } = mergeModuleStructures(base, mine, theirs);
    const [conflict] = conflictsFromCollisions(merged, collisions);
    expect(conflict.kind).toBe('reorder');
    const resolved = applyTheirs(merged, conflict);
    expect(resolved.weekStructure[0].components.map(item => item.id)).toEqual(['C2', 'C1', 'C3']);
  });

  it('server findings become the same questions, and repeats are not listed twice', () => {
    const base = module();
    const fromServer = conflictsFromServer(base, [
      { path: 'weekStructure[W1].components[C9]', kind: 'remote-deleted', local: null, remote: null },
    ]);
    expect(fromServer[0].itemId).toBe('C9');
    expect(mergeConflictLists(fromServer, fromServer)).toHaveLength(1);
  });
});
