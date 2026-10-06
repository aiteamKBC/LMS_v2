import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyLiveSessionLinkToComponents,
  replaceModuleTeamsLinks,
  type ModuleCatalogueItem,
} from '../moduleAuthoringData';

function module(): ModuleCatalogueItem {
  return {
    catalogueId: 'MOD-TEST',
    weekStructure: [
      {
        id: 'WEEK-A',
        components: [
          { id: 'LIVE-SAVED', type: 'live-session', settings: { liveSessionUrl: 'https://old.example/join', teamsEventId: 'EVENT-1' } },
          { id: 'LIVE-UNSAVED', type: 'live-session', settings: { liveSessionUrl: 'https://old.example/join' } },
        ],
      },
      { id: 'WEEK-B', components: [{ id: 'VIDEO', type: 'video', settings: {} }] },
    ],
  } as unknown as ModuleCatalogueItem;
}

describe('applyLiveSessionLinkToComponents', () => {
  it('changes only the components the server rewrote, keeping their meeting identity', () => {
    const source = module();
    const next = applyLiveSessionLinkToComponents(source, ['LIVE-SAVED'], ' https://new.example/join ');
    const [saved, unsaved] = next.weekStructure[0].components;

    expect(saved.settings).toMatchObject({
      liveSessionUrl: 'https://new.example/join',
      teamsMeetingUrl: 'https://new.example/join',
      liveSessionLinkOverride: 'https://new.example/join',
      teamsEventId: 'EVENT-1',
    });
    expect(unsaved.settings.liveSessionUrl).toBe('https://old.example/join');
    expect(next.weekStructure[1]).toBe(source.weekStructure[1]);
  });

  it('returns the module untouched when nothing was updated', () => {
    const source = module();
    expect(applyLiveSessionLinkToComponents(source, [], 'https://new.example/join')).toBe(source);
  });
});

describe('replaceModuleTeamsLinks', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends only the weeks, the link and the revision -- never the module', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      updated: 1, updatedComponentIds: ['LIVE-SAVED'], link: 'https://new.example/join', structureRevision: 'REV-2', revisionWasCurrent: true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await replaceModuleTeamsLinks('MOD-TEST', { weekIds: ['WEEK-A'], link: 'https://new.example/join', expectedRevision: 'REV-1' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/curriculum\/modules\/MOD-TEST\/teams-links\/$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ weekIds: ['WEEK-A'], link: 'https://new.example/join', expectedRevision: 'REV-1' });
    expect(result.updatedComponentIds).toEqual(['LIVE-SAVED']);
  });

  it("surfaces the server's own reason when it refuses", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'This module uses the Teams meeting of module MOD-SOURCE. Replace the links on that module instead.',
    }), { status: 409, headers: { 'Content-Type': 'application/json' } })));

    await expect(replaceModuleTeamsLinks('MOD-TEST', { weekIds: ['WEEK-A'], link: 'https://new.example/join' }))
      .rejects.toThrow('Replace the links on that module instead.');
  });
});
