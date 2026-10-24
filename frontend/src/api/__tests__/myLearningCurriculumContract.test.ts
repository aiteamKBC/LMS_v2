// Consumer contract for the My Learning curriculum reads. The Backend Phase 2
// work moves the assigned-curriculum source to the "Learner" schema behind
// these same endpoints with no envelope change; these cases pin what the
// Frontend relies on so that swap can be verified against them.
// Synthetic data only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { myLearningCatalogue, myLearningModule, type MyLearningCatalogue } from '@/api/myLearning';
import { clearAllCachedResources } from '@/api/cachedRequest';
import type { LearnerComponentEntry } from '@/api/learnerDetail';

const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const urls = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url));

const catalogue = (overrides: Partial<MyLearningCatalogue> = {}): MyLearningCatalogue => ({
  learner: { id: '701', kind: 'commercial', name: 'Synthetic learner', programme: 'Synthetic programme', cohort: '', group: '' },
  summary: { current: { subjects: 0, total: 0, completed: 0, percent: 0 }, previous: { subjects: 0, total: 0, completed: 0, percent: 0 }, subjectCount: 0 },
  modules: [], otjh: { actual: null, planned: null }, upcoming: [], hasMoreUpcoming: false,
  ...overrides,
});

const component = (id: string, overrides: Partial<LearnerComponentEntry> = {}): LearnerComponentEntry => ({
  componentId: id, moduleId: 'SYN-M1', weekId: 'SYN-W1', module: 'Synthetic module', week: 'Week 1',
  component: `Synthetic activity ${id}`, expectedOtjh: 1, type: 'reading', ...overrides,
});

const moduleResponse = (components: LearnerComponentEntry[], learnerId = '701') => ({
  subjectId: 'current:SYN-M1',
  detail: { id: learnerId, name: 'Synthetic learner', programme: 'Synthetic programme', modules: ['Synthetic module'],
    week: [{ module: 'Synthetic module', week: 'Week 1', moduleId: 'SYN-M1', weekId: 'SYN-W1' },
      { module: 'Synthetic module', week: 'Week 1', moduleId: 'SYN-M1', weekId: 'SYN-W1-TIE' },
      { module: null, week: 'Orphan week', moduleId: null, weekId: 'SYN-W-ORPHAN' }],
    components, ksbs: [], quizAttempts: [], componentProgress: [], videoProgress: [] },
  activity: null, metadata: { covers: {}, current_subjects: [], builder_subjects: {} },
  schedule: { modules: [], moduleLinks: {}, generatedAt: '' }, sessions: [],
});

let respond: (url: string) => Response;
beforeEach(() => {
  clearAllCachedResources();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => respond(String(input))));
});
afterEach(() => { clearAllCachedResources(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('My Learning catalogue contract', () => {
  it('reads the existing endpoint and keeps assigned modules in the served order, ties included', async () => {
    const modules = ['SYN-M2', 'SYN-M1', 'SYN-M1-TIE'].map(id => ({ id: `current:${id}`, title: `Synthetic ${id}`, source: 'current' as const,
      moduleId: id, activityCount: 1, completedActivityCount: 0, progress: 0, status: 'Upcoming' as const, finalTestPassed: false, actualHours: 0 }));
    respond = () => reply(catalogue({ modules }));
    const result = await myLearningCatalogue.read('commercial', '701');
    expect(urls()).toEqual(['/learner_api/my-learning/commercial/701/']);
    expect(result.modules.map(card => card.moduleId)).toEqual(['SYN-M2', 'SYN-M1', 'SYN-M1-TIE']);
  });

  it('accepts an explicitly empty assignment as an empty catalogue, not an error', async () => {
    respond = () => reply(catalogue({ modules: [] }));
    await expect(myLearningCatalogue.read('commercial', '701')).resolves.toMatchObject({ modules: [] });
  });

  it('rejects a response for another learner or learner type', async () => {
    respond = () => reply(catalogue({ learner: { id: '702', kind: 'commercial', name: '', programme: '', cohort: '', group: '' } }));
    await expect(myLearningCatalogue.read('commercial', '701')).rejects.toThrow('Could not load your subjects');
    clearAllCachedResources();
    respond = () => reply(catalogue({ learner: { id: '701', kind: 'apprenticeship', name: '', programme: '', cohort: '', group: '' } }));
    await expect(myLearningCatalogue.read('commercial', '701')).rejects.toThrow('Could not load your subjects');
  });

  it('rejects a catalogue whose modules are not an array (e.g. a raw null plan)', async () => {
    respond = () => reply({ ...catalogue(), modules: null });
    await expect(myLearningCatalogue.read('commercial', '701')).rejects.toThrow('Could not load your subjects');
  });
});

describe('My Learning module contract (weeks, activities, KSB mappings)', () => {
  it('keeps weeks and activities exactly as served: order, ties, null refs and blank titles', async () => {
    const components = [
      component('SYN-C2', { pointNumber: 1 }),
      component('SYN-C1', { pointNumber: 1 }),
      component('SYN-C-TIE', { weekId: 'SYN-W1-TIE' }),
      component('SYN-C-ORPHAN', { moduleId: null, weekId: null, module: null, week: null }),
      component('SYN-C-BLANK', { component: '' }),
    ];
    respond = () => reply(moduleResponse(components));
    const result = await myLearningModule.read('commercial', '701', 'current:SYN-M1');
    expect(urls()).toEqual(['/learner_api/my-learning/commercial/701/modules/current%3ASYN-M1/']);
    expect(result.detail.week.map(week => week.weekId)).toEqual(['SYN-W1', 'SYN-W1-TIE', 'SYN-W-ORPHAN']);
    expect(result.detail.components.map(item => item.componentId)).toEqual(['SYN-C2', 'SYN-C1', 'SYN-C-TIE', 'SYN-C-ORPHAN', 'SYN-C-BLANK']);
    expect(result.detail.components[3]).toMatchObject({ moduleId: null, weekId: null, module: null, week: null });
    expect(result.detail.components[4].component).toBe('');
  });

  it('passes component KSB mappings through with code, classification and weight intact', async () => {
    const ksbMappings = [
      { code: 'K1', description: 'Synthetic knowledge', classification: 'main', weight: 2.5 },
      { code: 'S1', description: null, classification: null, weight: 0.25 },
    ];
    respond = () => reply(moduleResponse([
      component('SYN-C-KSB', { ksbMappings, ksbMappingCount: 2, ksbWeightTotal: 2.75 }),
      component('SYN-C-UNGATED', { ksbMappings: [], ksbMappingCount: 0, ksbWeightTotal: 0 }),
    ]));
    const result = await myLearningModule.read('commercial', '701', 'current:SYN-M1');
    expect(result.detail.components[0]).toMatchObject({ ksbMappings, ksbMappingCount: 2, ksbWeightTotal: 2.75 });
    expect(result.detail.components[1]).toMatchObject({ ksbMappings: [], ksbMappingCount: 0 });
  });

  it('rejects a module response for another learner or without a components array', async () => {
    respond = () => reply(moduleResponse([component('SYN-C1')], '702'));
    await expect(myLearningModule.read('commercial', '701', 'current:SYN-M1')).rejects.toThrow('Could not load this subject');
    clearAllCachedResources();
    respond = () => { const body = moduleResponse([]); return reply({ ...body, detail: { ...body.detail, components: null } }); };
    await expect(myLearningModule.read('commercial', '701', 'current:SYN-M1')).rejects.toThrow('Could not load this subject');
  });

  it('surfaces a server failure instead of an empty module', async () => {
    respond = () => reply({ error: 'Synthetic outage' }, 503);
    await expect(myLearningModule.read('apprenticeship', '701', 'current:SYN-M1')).rejects.toThrow();
  });
});
