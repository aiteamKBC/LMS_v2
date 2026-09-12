import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The transport on its own: does a write announced in one tab reach the others,
 * does the tab that announced it stay quiet, and does a browser without
 * BroadcastChannel still let a save through.
 */

const CHANNEL_NAME = 'kbc-lms-writes';

type FakeMessage = { data: unknown };

const registry = new Map<string, Set<FakeChannel>>();

class FakeChannel {
  name: string;
  onmessage: ((event: FakeMessage) => void) | null = null;
  closed = false;

  constructor(name: string) {
    this.name = name;
    const peers = registry.get(name) || new Set<FakeChannel>();
    peers.add(this);
    registry.set(name, peers);
  }

  /** Real BroadcastChannel never delivers to the sender. Neither does this. */
  postMessage(data: unknown) {
    if (this.closed) throw new DOMException('closed', 'InvalidStateError');
    registry.get(this.name)?.forEach(peer => {
      if (peer === this || peer.closed) return;
      peer.onmessage?.({ data: structuredClone(data) });
    });
  }

  close() {
    this.closed = true;
    registry.get(this.name)?.delete(this);
  }

  addEventListener() {}
  removeEventListener() {}
}

async function loadModule() {
  vi.resetModules();
  return import('@/lib/crossTabWrites');
}

describe('crossTabWrites', () => {
  beforeEach(() => {
    registry.clear();
    vi.stubGlobal('BroadcastChannel', FakeChannel);
  });

  afterEach(() => {
    registry.clear();
    vi.unstubAllGlobals();
  });

  it('delivers a write to another tab with its path, scope and time', async () => {
    const other = await loadModule();
    const heard: unknown[] = [];
    other.subscribeCrossTabWrites(write => heard.push(write));

    // The "writing tab" is a second channel on the same name.
    const writer = new FakeChannel(CHANNEL_NAME);
    writer.postMessage({ path: '/curriculum/programmes/7/', scope: 'curriculum', at: 1 });

    expect(heard).toEqual([{ path: '/curriculum/programmes/7/', scope: 'curriculum', at: 1 }]);
    other.resetCrossTabWrites();
  });

  it('does not deliver a tab its own write', async () => {
    const mod = await loadModule();
    const heard: unknown[] = [];
    mod.subscribeCrossTabWrites(write => heard.push(write));

    mod.publishCrossTabWrite('curriculum', '/curriculum/groups/3/');

    expect(heard).toEqual([]);
    mod.resetCrossTabWrites();
  });

  it('reaches a listening tab when another tab publishes through the module', async () => {
    const mod = await loadModule();
    const heard: string[] = [];
    mod.subscribeCrossTabWrites(write => heard.push(write.path));

    // A second, independent copy of the module -- i.e. the other tab.
    vi.resetModules();
    const writerTab = await import('@/lib/crossTabWrites');
    writerTab.publishCrossTabWrite('curriculum', '/curriculum/cohorts/9/');

    expect(heard).toEqual(['/curriculum/cohorts/9/']);
    expect(registry.get(CHANNEL_NAME)?.size).toBe(2);
    writerTab.resetCrossTabWrites();
    mod.resetCrossTabWrites();
  });

  it('keeps delivering after a listener throws', async () => {
    const mod = await loadModule();
    const heard: string[] = [];
    mod.subscribeCrossTabWrites(() => { throw new Error('page blew up'); });
    mod.subscribeCrossTabWrites(write => heard.push(write.path));

    new FakeChannel(CHANNEL_NAME).postMessage({ path: '/curriculum/modules/2/', scope: 'curriculum', at: 1 });

    expect(heard).toEqual(['/curriculum/modules/2/']);
    mod.resetCrossTabWrites();
  });

  it('ignores a message that is not a write', async () => {
    const mod = await loadModule();
    const heard: unknown[] = [];
    mod.subscribeCrossTabWrites(write => heard.push(write));

    const writer = new FakeChannel(CHANNEL_NAME);
    writer.postMessage(null);
    writer.postMessage({ scope: 'curriculum' });

    expect(heard).toEqual([]);
    mod.resetCrossTabWrites();
  });

  it('stops delivering once unsubscribed', async () => {
    const mod = await loadModule();
    const heard: string[] = [];
    const stop = mod.subscribeCrossTabWrites(write => heard.push(write.path));
    stop();

    new FakeChannel(CHANNEL_NAME).postMessage({ path: '/curriculum/programmes/1/', scope: 'curriculum', at: 1 });

    expect(heard).toEqual([]);
    mod.resetCrossTabWrites();
  });

  it('publishing is a no-op where BroadcastChannel does not exist', async () => {
    // Older Safari, and some embedded webviews. A save must not throw there.
    vi.stubGlobal('BroadcastChannel', undefined);
    const mod = await loadModule();
    const heard: unknown[] = [];
    mod.subscribeCrossTabWrites(write => heard.push(write));

    expect(() => mod.publishCrossTabWrite('curriculum', '/curriculum/programmes/1/')).not.toThrow();
    expect(heard).toEqual([]);
    mod.resetCrossTabWrites();
  });

  it('survives a channel that refuses to post', async () => {
    // A tab being torn down closes its channel; the save in flight must finish.
    const mod = await loadModule();
    mod.subscribeCrossTabWrites(() => {});
    registry.get(CHANNEL_NAME)?.forEach(channel => { channel.closed = true; });

    expect(() => mod.publishCrossTabWrite('curriculum', '/curriculum/programmes/1/')).not.toThrow();
    mod.resetCrossTabWrites();
  });
});
