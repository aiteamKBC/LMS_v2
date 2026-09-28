import { describe, expect, it } from 'vitest';
import { mergeModuleStructures } from '../mergeModuleStructure';
import type { ModuleCatalogueItem, ModuleComponent, ModuleWeek } from '@/pages/curriculum/module-builder/moduleAuthoringData';

/**
 * The structural half of co-editing: two people in the Module Builder at once.
 *
 * Every case is stated as the two editors' actual moves, because that is what
 * decides the answer. What these are guarding is the promise the screen makes
 * when it merges without asking -- that nothing either of them authored is
 * dropped silently, and that the only thing they are told about is a field they
 * genuinely both changed.
 */

function component(id: string, overrides: Partial<ModuleComponent> = {}): ModuleComponent {
  return {
    id,
    weekId: 'WEEK-1',
    type: 'reading',
    title: `Component ${id}`,
    description: '',
    expectedOtjh: 1,
    points: 5,
    reflectionRequired: false,
    reflectionQuestion: '',
    workplaceEvidenceRequired: false,
    tutorValidationRequired: false,
    coachValidationRequired: true,
    ksbMappings: [],
    settings: {},
    ...overrides,
  };
}

function week(id: string, components: ModuleComponent[], overrides: Partial<ModuleWeek> = {}): ModuleWeek {
  return {
    id,
    moduleId: 'MOD-1',
    weekNumber: 1,
    title: `Week ${id}`,
    summary: '',
    learningOutcomes: [],
    components: components.map(item => ({ ...item, weekId: id })),
    ksbMappings: [],
    ...overrides,
  };
}

function moduleWith(weeks: ModuleWeek[], overrides: Partial<ModuleCatalogueItem> = {}): ModuleCatalogueItem {
  return {
    id: 'MOD-1',
    catalogueId: 'MOD-1',
    programmeId: 'PROG-1',
    programmeName: 'Programme',
    title: 'Module one',
    description: '',
    status: 'draft',
    weeks: weeks.length,
    totalOtjh: 0,
    ksbCount: 0,
    lessonCount: 0,
    quizCount: 0,
    qualityScore: 0,
    moduleKsbMappings: [],
    completionCriteria: {
      quizzesCompletedRequired: false,
      checkpointsCompletedRequired: false,
      averageScoreRequiredEnabled: false,
      averageScoreRequired: 70,
      totalScoreRequiredEnabled: false,
      totalScoreRequired: 100,
      additionalNotes: '',
    },
    advancedDetails: {} as ModuleCatalogueItem['advancedDetails'],
    background: '',
    epaRequirements: [],
    qualificationOutcomes: [],
    weekStructure: weeks,
    ...overrides,
  } as ModuleCatalogueItem;
}

/** Ids of the weeks in order, for the reorder and add/delete cases. */
const weekIds = (module: ModuleCatalogueItem) => module.weekStructure.map(item => item.id);
const componentIds = (module: ModuleCatalogueItem, at = 0) => module.weekStructure[at].components.map(item => item.id);

describe('module structure merge', () => {
  // --- 1. different fields on the same item -------------------------------
  it('keeps both editors when they change different fields of one week', () => {
    const base = moduleWith([week('W1', [component('C1')])]);
    const local = moduleWith([week('W1', [component('C1')], { summary: 'B wrote the summary' })]);
    const remote = moduleWith([week('W1', [component('C1')], { title: 'A renamed the week' })]);

    const { module, notices } = mergeModuleStructures(base, local, remote);

    expect(module.weekStructure[0].title).toBe('A renamed the week');
    expect(module.weekStructure[0].summary).toBe('B wrote the summary');
    expect(notices).toEqual([]);
  });

  it('keeps both editors when they change different components', () => {
    const base = moduleWith([week('W1', [component('C1'), component('C2')])]);
    const local = moduleWith([week('W1', [component('C1', { title: 'B edited this' }), component('C2')])]);
    const remote = moduleWith([week('W1', [component('C1'), component('C2', { title: 'A edited this' })])]);

    const { module, notices } = mergeModuleStructures(base, local, remote);

    expect(module.weekStructure[0].components.map(item => item.title)).toEqual(['B edited this', 'A edited this']);
    expect(notices).toEqual([]);
  });

  it('keeps both editors when they change different weeks', () => {
    const base = moduleWith([week('W1', []), week('W2', [])]);
    const local = moduleWith([week('W1', [], { title: 'B week one' }), week('W2', [])]);
    const remote = moduleWith([week('W1', []), week('W2', [], { title: 'A week two' })]);

    const { module, notices } = mergeModuleStructures(base, local, remote);

    expect(module.weekStructure.map(item => item.title)).toEqual(['B week one', 'A week two']);
    expect(notices).toEqual([]);
  });

  // --- 2. the same field --------------------------------------------------
  it('keeps this reader and names only the field both changed', () => {
    const base = moduleWith([week('W1', [component('C1')]), week('W2', [])]);
    const local = moduleWith([week('W1', [component('C1')], { title: 'B title' }), week('W2', [])]);
    const remote = moduleWith([week('W1', [component('C1')], { title: 'A title' }), week('W2', [], { summary: 'A summary' })]);

    const { module, notices } = mergeModuleStructures(base, local, remote);

    expect(module.weekStructure[0].title).toBe('B title');
    // Week two is not in the disagreement, and is not reported as one.
    expect(module.weekStructure[1].summary).toBe('A summary');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/both changed the title/i);
    expect(notices[0]).toMatch(/Week 1/);
    expect(notices[0]).toMatch(/A title/);
  });

  it('names the component, not the payload path, when both edit one component', () => {
    const base = moduleWith([week('W1', [component('C1', { title: 'Reading task' })])]);
    const local = moduleWith([week('W1', [component('C1', { title: 'Reading task', description: 'B text' })])]);
    const remote = moduleWith([week('W1', [component('C1', { title: 'Reading task', description: 'A text' })])]);

    const { notices } = mergeModuleStructures(base, local, remote);

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/both changed the description in Reading task, in Week 1/i);
  });

  // --- adds, deletes ------------------------------------------------------
  it('takes a week the other editor added while this one edited another', () => {
    const base = moduleWith([week('W1', [])]);
    const local = moduleWith([week('W1', [], { title: 'B edited week one' })]);
    const remote = moduleWith([week('W1', []), week('W2', [])]);

    const { module, notices } = mergeModuleStructures(base, local, remote);

    expect(weekIds(module)).toEqual(['W1', 'W2']);
    expect(module.weekStructure[0].title).toBe('B edited week one');
    expect(notices).toEqual([]);
  });

  it('ends up with both weeks when the two editors add one each', () => {
    const base = moduleWith([week('W1', [])]);
    const local = moduleWith([week('W1', []), week('B-NEW', [])]);
    const remote = moduleWith([week('W1', []), week('A-NEW', [])]);

    const { module, notices } = mergeModuleStructures(base, local, remote);

    expect(weekIds(module)).toEqual(['W1', 'B-NEW', 'A-NEW']);
    expect(notices).toEqual([]);
  });

  it('honours a delete of an item this reader never touched', () => {
    const base = moduleWith([week('W1', []), week('W2', [])]);
    const local = moduleWith([week('W1', [], { title: 'B edited week one' }), week('W2', [])]);
    const remote = moduleWith([week('W1', [])]);

    const { module, notices } = mergeModuleStructures(base, local, remote);

    expect(weekIds(module)).toEqual(['W1']);
    expect(module.weekStructure[0].title).toBe('B edited week one');
    expect(notices).toEqual([]);
  });

  it('keeps a week the other editor deleted under an editor who was working in it', () => {
    const base = moduleWith([week('W1', []), week('W2', [component('C9')])]);
    const local = moduleWith([week('W1', []), week('W2', [component('C9', { title: 'B authored this' })])]);
    const remote = moduleWith([week('W1', [])]);

    const { module, notices } = mergeModuleStructures(base, local, remote);

    expect(weekIds(module)).toEqual(['W1', 'W2']);
    expect(module.weekStructure[1].components[0].title).toBe('B authored this');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/deleted/i);
  });

  it('leaves a deleted week deleted when this reader is the one who deleted it', () => {
    const base = moduleWith([week('W1', []), week('W2', [])]);
    const local = moduleWith([week('W1', [])]);
    const remote = moduleWith([week('W1', []), week('W2', [], { title: 'A renamed it' })]);

    const { module, notices } = mergeModuleStructures(base, local, remote);

    expect(weekIds(module)).toEqual(['W1']);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/stays deleted/i);
  });

  // --- ids, not positions -------------------------------------------------
  it('matches items by id rather than by position', () => {
    // The other editor deleted the FIRST week, so every surviving week has moved
    // up one place. Matching by position would apply this reader's edit to the
    // wrong week.
    const base = moduleWith([week('W1', []), week('W2', []), week('W3', [])]);
    const local = moduleWith([week('W1', []), week('W2', []), week('W3', [], { title: 'B edited week three' })]);
    const remote = moduleWith([week('W2', []), week('W3', [])]);

    const { module } = mergeModuleStructures(base, local, remote);

    expect(weekIds(module)).toEqual(['W2', 'W3']);
    expect(module.weekStructure.find(item => item.id === 'W3')?.title).toBe('B edited week three');
    // Ids are never rewritten by a merge: a new id is a new record to the
    // backend, and to the Teams meeting hanging off it.
    expect(componentIds(module)).toEqual([]);
  });

  it('renumbers the merged weeks in the order they end up in', () => {
    const base = moduleWith([week('W1', [])]);
    const local = moduleWith([week('W1', []), week('B-NEW', [])]);
    const remote = moduleWith([week('W1', []), week('A-NEW', [])]);

    const { module } = mergeModuleStructures(base, local, remote);

    expect(module.weekStructure.map(item => item.weekNumber)).toEqual([1, 2, 3]);
  });

  // --- Teams ownership ----------------------------------------------------
  it('never lets a stale copy re-assert a meeting id over the stored one', () => {
    const live = (settings: ModuleComponent['settings']) => component('C1', { type: 'live-session', settings });
    const base = moduleWith([week('W1', [live({})])]);
    // This workspace was open before the meeting was created, so it holds no
    // ids -- and it has edited the same component.
    const local = moduleWith([week('W1', [live({ sessionPurpose: 'B typed this' })])]);
    const remote = moduleWith([week('W1', [live({ teamsEventId: 'AAMk-event', teamsMeetingUrl: 'https://teams/x' })])]);

    const { module, notices } = mergeModuleStructures(base, local, remote);

    const settings = module.weekStructure[0].components[0].settings as Record<string, unknown>;
    expect(settings.teamsEventId).toBe('AAMk-event');
    expect(settings.teamsMeetingUrl).toBe('https://teams/x');
    expect(settings.sessionPurpose).toBe('B typed this');
    expect(notices).toEqual([]);
  });

  // --- derived values -----------------------------------------------------
  it('does not report derived totals as a disagreement', () => {
    const base = moduleWith([week('W1', [component('C1')])], { lessonCount: 1, qualityScore: 10, totalOtjh: 1 });
    const local = moduleWith([week('W1', [component('C1'), component('B-NEW')])], { lessonCount: 2, qualityScore: 20, totalOtjh: 2 });
    const remote = moduleWith([week('W1', [component('C1'), component('A-NEW')])], { lessonCount: 2, qualityScore: 30, totalOtjh: 2 });

    const { module, notices } = mergeModuleStructures(base, local, remote);

    expect(componentIds(module)).toEqual(['C1', 'B-NEW', 'A-NEW']);
    expect(notices).toEqual([]);
  });

  // --- nothing to merge ---------------------------------------------------
  it('takes the stored module whole when this reader has changed nothing', () => {
    const base = moduleWith([week('W1', [])]);
    const remote = moduleWith([week('W1', [], { title: 'A renamed it' }), week('W2', [])]);

    const { module, notices, adopted } = mergeModuleStructures(base, base, remote);

    expect(weekIds(module)).toEqual(['W1', 'W2']);
    expect(module.weekStructure[0].title).toBe('A renamed it');
    expect(notices).toEqual([]);
    expect(adopted).toBeGreaterThan(0);
  });

  // --- reorder ------------------------------------------------------------
  it('keeps this reader order and says so when both editors reordered', () => {
    const base = moduleWith([week('W1', []), week('W2', []), week('W3', [])]);
    const local = moduleWith([week('W2', []), week('W1', []), week('W3', [])]);
    const remote = moduleWith([week('W3', []), week('W1', []), week('W2', [])]);

    const { module, notices } = mergeModuleStructures(base, local, remote);

    expect(weekIds(module)).toEqual(['W2', 'W1', 'W3']);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/both reordered the weeks/i);
  });

  it('does not read a delete as a reorder', () => {
    const base = moduleWith([week('W1', []), week('W2', []), week('W3', [])]);
    const local = moduleWith([week('W1', []), week('W2', []), week('W3', [], { title: 'B edited' })]);
    const remote = moduleWith([week('W1', []), week('W3', [])]);

    const { module, notices } = mergeModuleStructures(base, local, remote);

    expect(weekIds(module)).toEqual(['W1', 'W3']);
    expect(notices).toEqual([]);
  });

  it('keeps a week this reader added in place when the other editor reorders', () => {
    const base = moduleWith([week('W1', []), week('W2', [])]);
    const local = moduleWith([week('W1', []), week('B-NEW', []), week('W2', [])]);
    const remote = moduleWith([week('W2', []), week('W1', [])]);

    const { module, notices } = mergeModuleStructures(base, local, remote);

    // Their order for the weeks they know, and this reader's new week still
    // sitting where they put it -- behind week one.
    expect(weekIds(module)).toEqual(['W2', 'W1', 'B-NEW']);
    expect(notices).toEqual([]);
  });

  it('merges a reorder of the components inside one week', () => {
    const base = moduleWith([week('W1', [component('C1'), component('C2'), component('C3')])]);
    const local = moduleWith([week('W1', [component('C1', { title: 'B edited this' }), component('C2'), component('C3')])]);
    const remote = moduleWith([week('W1', [component('C3'), component('C1'), component('C2')])]);

    const { module, notices } = mergeModuleStructures(base, local, remote);

    expect(componentIds(module)).toEqual(['C3', 'C1', 'C2']);
    expect(module.weekStructure[0].components[1].title).toBe('B edited this');
    expect(notices).toEqual([]);
  });

  it('keeps the other editor reorder when this one has not reordered', () => {
    const base = moduleWith([week('W1', []), week('W2', []), week('W3', [])]);
    const local = moduleWith([week('W1', []), week('W2', []), week('W3', [], { summary: 'B wrote this' })]);
    const remote = moduleWith([week('W3', []), week('W1', []), week('W2', [])]);

    const { module, notices } = mergeModuleStructures(base, local, remote);

    expect(weekIds(module)).toEqual(['W3', 'W1', 'W2']);
    expect(module.weekStructure.find(item => item.id === 'W3')?.summary).toBe('B wrote this');
    expect(notices).toEqual([]);
  });
});
