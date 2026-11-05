import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadModuleStructureChanges,
  moduleStructureDelta,
  ModuleStructureConflictError,
  readModuleLiveState,
  recalculateModule,
  saveModuleStructure,
  serverCopyOf,
  type ModuleCatalogueItem,
} from '../moduleAuthoringData';

/**
 * The browser keeps the server's own copy of an open module beside the copy it
 * edits. A save sends the server's copies of what it touched, so the server can
 * merge it with a colleague's save item by item; the changes feed rebuilds the
 * stored module from the few items that moved. Both only work if the copy is
 * exact and travels only where it should.
 */

const raw = (title = 'Reading one') => ({
  catalogueId: 'MOD-1',
  title: 'Module',
  structureRevision: 'rev-1',
  weekStructure: [
    {
      id: 'W1', weekNumber: 1, title: 'Week 1', summary: '', learningOutcomes: [], ksbMappings: [],
      components: [
        { id: 'C1', weekId: 'W1', moduleId: 'MOD-1', type: 'reading', title, description: '', expectedOtjh: 1, points: 0, ksbMappings: [], settings: {} },
        { id: 'C2', weekId: 'W1', moduleId: 'MOD-1', type: 'reading', title: 'Reading two', description: '', expectedOtjh: 1, points: 0, ksbMappings: [], settings: {} },
      ],
    },
  ],
  itemFingerprints: { weeks: { W1: 'fw1' }, components: { C1: title === 'Reading one' ? 'fc1' : 'fc1b', C2: 'fc2' } },
});

let fetchMock: ReturnType<typeof vi.fn>;

function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

function sentBody(call = 0) {
  return JSON.parse(String(fetchMock.mock.calls[call][1].body));
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function savedModule() {
  respond(raw());
  const saved = await saveModuleStructure('MOD-1', recalculateModule(raw() as unknown as ModuleCatalogueItem));
  fetchMock.mockReset();
  return saved;
}

describe('server copy', () => {
  it('is kept beside a module the server sent, and never inside it', async () => {
    const saved = await savedModule();
    expect('itemFingerprints' in saved).toBe(false);
    const copy = serverCopyOf(saved);
    expect(copy?.revision).toBe('rev-1');
    expect(copy?.fingerprints.components).toEqual({ C1: 'fc1', C2: 'fc2' });
    expect(copy?.componentOrder).toEqual({ W1: ['C1', 'C2'] });
    expect(serverCopyOf(recalculateModule(saved))).toBeNull();
  });

  it('a partial save sends the server copies of only what it changed or removed', async () => {
    const base = await savedModule();
    const current = recalculateModule({
      ...base,
      weekStructure: [{ ...base.weekStructure[0], components: [{ ...base.weekStructure[0].components[0], title: 'Mine' }] }],
    });
    respond(raw('Mine'));
    await saveModuleStructure('MOD-1', current, {
      expectedRevision: 'rev-1', base, serverCopy: serverCopyOf(base), restoreIds: ['C7'],
    });
    const body = sentBody();
    expect(body.saveMode).toBe('partial');
    expect(Object.keys(body.structureDelta.components)).toEqual(['C1']);
    // C1 changed, C2 removed: their server copies travel, nothing else does.
    expect(Object.keys(body.structureBase.components).sort()).toEqual(['C1', 'C2']);
    expect(body.structureBase.components.C1.title).toBe('Reading one');
    expect(body.structureBase.fingerprints.components).toEqual({ C1: 'fc1', C2: 'fc2' });
    expect(body.structureBase.weeks).toEqual({});
    // Beside each server copy, the same item as this workspace holds it, so the
    // server measures "did the author change it?" against the author's copy.
    expect(Object.keys(body.structureBase.localComponents).sort()).toEqual(['C1', 'C2']);
    expect(body.structureBase.localComponents.C1.title).toBe('Reading one');
    expect(body.structureBase.localModule.weekStructure).toBeUndefined();
    expect(body.restoreIds).toEqual(['C7']);
  });

  it('a copy from another revision is never sent as the base', async () => {
    const base = await savedModule();
    respond(raw());
    await saveModuleStructure('MOD-1', base, { expectedRevision: 'rev-2', base, serverCopy: serverCopyOf(base) });
    expect(sentBody().structureBase).toBeUndefined();
  });

  it('a refusal for a real conflict carries the server findings', async () => {
    const base = await savedModule();
    respond({
      conflict: true,
      error: 'Someone else changed the same thing.',
      currentRevision: 'rev-2',
      mergeConflicts: [{ path: 'weekStructure[W1].components[C1].title', kind: 'value', local: 'Mine', remote: 'Theirs' }],
    }, 409);
    const error = await saveModuleStructure('MOD-1', base, { expectedRevision: 'rev-1', base, serverCopy: serverCopyOf(base) })
      .catch(err => err);
    expect(error).toBeInstanceOf(ModuleStructureConflictError);
    expect(error.conflicts).toEqual([{ path: 'weekStructure[W1].components[C1].title', kind: 'value', local: 'Mine', remote: 'Theirs' }]);
    expect(error.currentRevision).toBe('rev-2');
  });
});

describe('changes feed', () => {
  it('rebuilds exactly the module a full read returns from the items that moved', async () => {
    const base = await savedModule();
    const full = raw('Theirs');
    respond({
      revision: 'rev-2',
      module: { catalogueId: 'MOD-1', title: 'Module', structureRevision: 'rev-2' },
      weekOrder: ['W1'],
      componentOrder: { W1: ['C1', 'C2'] },
      weeks: {},
      components: { C1: full.weekStructure[0].components[0] },
      itemFingerprints: { weeks: { W1: 'fw1' }, components: { C1: 'fc1b', C2: 'fc2' } },
    });
    const changes = await loadModuleStructureChanges('MOD-1', serverCopyOf(base)!);
    const request = sentBody();
    expect(request).toEqual({ revision: 'rev-1', fingerprints: { weeks: { W1: 'fw1' }, components: { C1: 'fc1', C2: 'fc2' } } });
    expect(changes?.unchanged).toBe(false);
    if (!changes || changes.unchanged !== false) throw new Error('expected changes');
    const expected = recalculateModule({ ...full, structureRevision: 'rev-2' } as unknown as ModuleCatalogueItem);
    expect(JSON.parse(JSON.stringify(changes.module))).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(serverCopyOf(changes.module)?.revision).toBe('rev-2');
    expect(serverCopyOf(changes.module)?.fingerprints.components.C1).toBe('fc1b');
  });

  it('answers "unchanged" without a module, unless the caller needs the module itself', async () => {
    const base = await savedModule();
    respond({ revision: 'rev-1', unchanged: true });
    expect(await loadModuleStructureChanges('MOD-1', serverCopyOf(base)!)).toEqual({ unchanged: true, revision: 'rev-1' });
    respond({ revision: 'rev-1', unchanged: true });
    await loadModuleStructureChanges('MOD-1', serverCopyOf(base)!, { allowUnchanged: false });
    expect(sentBody(1).revision).toBe('');
  });

  it('gives up (null) rather than inventing an item it was never sent', async () => {
    const base = await savedModule();
    respond({
      revision: 'rev-2', module: {}, weekOrder: ['W1'], componentOrder: { W1: ['C1', 'C9'] },
      weeks: {}, components: {}, itemFingerprints: { weeks: {}, components: {} },
    });
    expect(await loadModuleStructureChanges('MOD-1', serverCopyOf(base)!)).toBeNull();
  });
});

describe('live state', () => {
  it('asks for exactly the watched scopes', async () => {
    respond({ enabled: false });
    expect(await readModuleLiveState(['module:MOD-1', 'group:GROUP-1'])).toEqual({ enabled: false });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/curriculum/live/?watch=module%3AMOD-1&watch=group%3AGROUP-1');
  });
});

describe('delta', () => {
  it('still names only the items that changed', () => {
    const base = recalculateModule(raw() as unknown as ModuleCatalogueItem);
    const current = recalculateModule(raw('Mine') as unknown as ModuleCatalogueItem);
    expect(Object.keys(moduleStructureDelta(base, current).components)).toEqual(['C1']);
  });
});
