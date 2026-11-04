import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmModuleSave } from '../confirmModuleSave';
import { createEmptyComponent, createLocalModuleDraft, type ModuleCatalogueItem } from '../moduleAuthoringData';

function moduleFixture(): ModuleCatalogueItem {
  const module = createLocalModuleDraft({ programme: 'Programme', title: 'Module', description: '', weeks: 2, status: 'draft', catalogueId: 'MOD-CONFIRM' });
  module.structureRevision = 'before';
  module.weekStructure[0].components = [{ ...createEmptyComponent(module.weekStructure[0].id, 'video', 1), id: 'C1',
    settings: { sourceType: 'YouTube', videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk' } }];
  return module;
}

afterEach(() => vi.useRealTimers());

describe('confirming an ambiguous module save', () => {
  it('confirms the complete authored content despite changed revision and derived totals', async () => {
    const sent = moduleFixture();
    const stored = { ...structuredClone(sent), structureRevision: 'committed', totalOtjh: 99, qualityScore: 25 };
    expect(await confirmModuleSave(sent, async () => stored)).toBe(stored);
  });

  it.each(['title', 'video', 'order', 'deleted', 'scope'])('does not confirm different %s values', async kind => {
    const sent = moduleFixture();
    const stored = { ...structuredClone(sent), structureRevision: 'other-write' };
    if (kind === 'title') stored.weekStructure[0].title = 'Different title';
    if (kind === 'video') stored.weekStructure[0].components[0].settings.videoUrl = 'https://example.com/old.mp4';
    if (kind === 'order') stored.weekStructure.reverse();
    if (kind === 'deleted') stored.weekStructure[0].components = [];
    if (kind === 'scope') stored.groupId = 'ANOTHER-GROUP';
    expect(await confirmModuleSave(sent, async () => stored)).toBeNull();
  });

  it('does not accept a different module or a missing revision', async () => {
    const sent = moduleFixture();
    expect(await confirmModuleSave(sent, async () => ({ ...sent, catalogueId: 'OTHER' }))).toBeNull();
    expect(await confirmModuleSave(sent, async () => ({ ...sent, structureRevision: '' }))).toBeNull();
  });

  it('retains uncertainty when the fresh read fails', async () => {
    expect(await confirmModuleSave(moduleFixture(), async () => { throw new Error('Offline'); })).toBeNull();
  });

  it('bounds the additional wait and ignores a response received after it', async () => {
    vi.useFakeTimers();
    const sent = moduleFixture();
    let release!: (module: ModuleCatalogueItem) => void;
    const confirmation = confirmModuleSave(sent, () => new Promise(resolve => { release = resolve; }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await confirmation).toBeNull();
    release({ ...sent, structureRevision: 'late' });
    expect(await confirmation).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
