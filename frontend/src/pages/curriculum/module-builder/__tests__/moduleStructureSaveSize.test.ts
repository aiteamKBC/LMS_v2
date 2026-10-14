import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalModuleDraft,
  MODULE_STRUCTURE_SAVE_LIMIT_BYTES,
  ModuleStructureTooLargeError,
  saveModuleStructure,
} from '../moduleAuthoringData';

function moduleWithDescription(bytes: number) {
  const draft = createLocalModuleDraft({ programme: 'Programme', title: 'Module', description: '', weeks: 1, status: 'draft', catalogueId: 'MOD-TEST' });
  return { ...draft, description: 'x'.repeat(bytes) };
}

describe('saveModuleStructure size refusals', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('explains an oversized module without sending it', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const save = saveModuleStructure('MOD-TEST', moduleWithDescription(MODULE_STRUCTURE_SAVE_LIMIT_BYTES + 1));

    await expect(save).rejects.toBeInstanceOf(ModuleStructureTooLargeError);
    await expect(save).rejects.toThrow(/too large to save/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns Django's HTML 400 for a large body into the size explanation", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<h1>Bad Request (400)</h1>', { status: 400, headers: { 'Content-Type': 'text/html' } })));

    const save = saveModuleStructure('MOD-TEST', moduleWithDescription(3 * 1024 * 1024));

    await expect(save).rejects.toBeInstanceOf(ModuleStructureTooLargeError);
    await expect(save).rejects.not.toThrow(/returned 400/);
  });

  it('leaves an ordinary JSON 400 with its own message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Week title is required.' }), { status: 400, headers: { 'Content-Type': 'application/json' } })));

    await expect(saveModuleStructure('MOD-TEST', moduleWithDescription(3 * 1024 * 1024))).rejects.toThrow('Week title is required.');
  });
});
